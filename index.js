'use strict';

var fs = require('graceful-fs');
var path = require('path');
var glob = require('glob');
var async = require('async');
var request = require('request');
var handlebars = require('handlebars');
var LRU = require('stale-lru-cache');

function RemoteHandlebars(options) {
    options || (options = {});
    var self = this;

    // Set options
    this.layout = ('layout' in options) ? options.layout : false;
    this.placeholder = options.placeholder || 'content';
    this.helpers = options.helpers;
    this.partialsDir = options.partialsDir || 'views/partials/';

    // Someone might want to override these
    this.request = options.request || request;
    this.handlebars = options.handlebars || handlebars;

    // Cache for remote views
    this.cache = LRU({ maxSize: options.size || options.max || options.maxSize, maxAge: options.maxAge, staleWhileRevalidate: options.staleWhileRevalidate });

    // Local views do not expire
    this.cacheForever = LRU();

    // Expose view engine
    this.engine = this.render.bind(this);
};

RemoteHandlebars.prototype.render = function render(filePath, options, callback) {
    var self = this;

    var context = options;
    var layout = ('layout' in options) ? options.layout : this.layout;
    var placeholder = options.placeholder || this.placeholder;
    var helpers = options.helpers || this.helpers;
    var partialsDir = options.partialsDir || this.partialsDir;

    var tasks = { view: viewTask };
    if (layout) tasks.layout = layoutTask;
    if (partialsDir) tasks.partials = partialsTask;

    async.parallel(tasks, function (error, results) {
        if (error) return callback(error);
        var settings = {
            helpers: helpers,
            partials: results.partials,
            data: options.data
        };
        var rendered = results.view(context, settings);
        if (results.layout) {
            context[placeholder] = rendered;
            rendered = results.layout(context, settings);
        }
        callback(null, rendered);
    });

    function viewTask(done) {
        self.getView(filePath, options, done);
    }
    function layoutTask(done) {
        if (typeof layout === 'function') return done(null, layout);
        self.getLayout(layout, options, done);
    }
    function partialsTask(done) {
        self.getPartials(partialsDir, options, done);
    }
};

RemoteHandlebars.prototype.getLayout = function getLayout(url, options, callback) {
    var self = this;

    if (typeof options === 'function') {
        callback = options;
        options = null;
    } else if (typeof url === 'function') {
        callback = url;
        options = null;
        url = null;
    }
    url || (url = this.layout);
    options || (options = {});

    if (!url) throw new Error('RemoteHandlebars.getLayout expects url or this.layout');
    if (!callback) throw new Error('RemoteHandlebars.getLayout expects callback');

    // Ensure accept header
    if (typeof url === 'string') {
        url = {url: url};
    }
    url.headers || (url.headers = {});
    url.headers['Accept'] = 'text/x-handlebars-template';

    if (options.cache === false) {
        return requestTemplate(null, function (error, template, cacheControl) {
            callback(error, template);
        });
    }
    this.cache.wrap(url.url, requestTemplate, callback);

    function requestTemplate(key, done) {
        self.requestTemplate(url, done);
    }
};

RemoteHandlebars.prototype.getView = function getView(filePath, options, callback) {
    var self = this;

    if (typeof options === 'function') {
        callback = options;
        options = null;
    }
    filePath = path.resolve(filePath);
    options || (options = {});

    if (!filePath) throw new Error('RemoteHandlebars.getView expects filePath');
    if (!callback) throw new Error('RemoteHandlebars.getView expects callback');

    if (options.cache === false) {
        return readTemplate(null, callback);
    }
    this.cacheForever.wrap(filePath, readTemplate, callback);

    function readTemplate(key, done) {
        self.readTemplate(filePath, done);
    }
};

RemoteHandlebars.prototype.getPartials = function getPartials(partialsDir, options, callback) {
    var self = this;

    if (typeof options === 'function') {
        callback = options;
        options = null;
    } else if (typeof partialsDir === 'function') {
        callback = partialsDir;
        options = null;
        partialsDir = null;
    }
    partialsDir || (partialsDir = this.partialsDir);
    options || (options = {});
    
    if (!partialsDir) throw new Error('RemoteHandlebars.getPartials expects partialsDir or this.partialsDir');
    if (!callback) throw new Error('RemoteHandlebars.getPartials expects callback');

    if (typeof partialsDir === 'string') {
        partialsDir = [partialsDir];
    }

    if (options.cache === false) {
        return findTemplates(null, callback);
    }
    this.cacheForever.wrap(partialsDir.join(''), findTemplates, callback);

    function findTemplates(key, done) {
        self.findTemplates(partialsDir, done);
    }
};

RemoteHandlebars.prototype.compile = function compile(template) {
    return this.handlebars.compile(template);
};

RemoteHandlebars.prototype.requestTemplate = function requestTemplate(url, callback) {
    var self = this;
    self.request(url, function (error, response, body) {
        if (error) return callback(error);
        if (response.statusCode >= 400) return callback(new Error('HTTP status code \''+response.statusCode+'\' received'));
        var template = self.compile(body);
        var cacheControl = response.headers['cache-control'];
        callback(null, template, cacheControl);
    });
};

RemoteHandlebars.prototype.readTemplate = function readTemplate(filePath, callback) {
    var self = this;
    fs.readFile(filePath, 'utf8', function (error, content) {
        if (error) return callback(error);
        var template = self.compile(content.toString());
        callback(null, template);
    });
};

RemoteHandlebars.prototype.findTemplates = function findTemplates(paths, callback) {
    var self = this;
    async.reduce(paths, {}, function (templates, dir, nextDir) {
        glob('**/*.{handlebars,hbs}', {cwd: dir}, function (error, files) {
            if (error) return nextDir(error);
            async.each(files, function (file, nextFile) {
                var filePath = path.resolve(dir, file);
                self.readTemplate(filePath, function (error, template) {
                    if (error) return nextFile(error);
                    var name = file.replace(/\.(handlebars|hbs)$/, '');
                    templates[name] = template;
                    nextFile();
                });
            }, function (error) {
                if (error) return nextDir(error);
                nextDir(null, templates);
            });
        });
    }, callback);
};

// Factory
module.exports = function (options) {
    return new RemoteHandlebars(options).engine;
};
module.exports.create = function (options) {
    return new RemoteHandlebars(options);
};
module.exports.RemoteHandlebars = RemoteHandlebars;
