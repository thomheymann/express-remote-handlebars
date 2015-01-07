'use strict';

var fs = require('graceful-fs');
var path = require('path');
var glob = require('glob');
var async = require('async');
var request = require('request');
var handlebars = require('handlebars');
var cacheManager = require('cache-manager');

function RemoteHandlebars(options) {
    options || (options = {});

    // Set options
    this.layout = ('layout' in options) ? options.layout : false;
    this.placeholder = options.placeholder || 'content';
    this.helpers = options.helpers;
    this.partialsDir = options.partialsDir || 'views/partials/';

    // Someone might want to override these
    this.request = options.request || request;
    this.handlebars = options.handlebars || handlebars;
    this.cache = options.cache || cacheManager.caching({
        store: 'memory',
        ttl: ('maxAge' in options) ? options.maxAge : 60,
        max: ('size' in options) ? options.size : Infinity
    }).wrap;

    // Permanent cache for local views
    this.cacheForever = cacheManager.caching({store: 'memory', ttl: Infinity, max: Infinity}).wrap;

    // Expose view engine
    this.engine = this.render.bind(this);
};

RemoteHandlebars.prototype.render = function (filePath, options, callback) {
    var context = options;
    var layout = ('layout' in options) ? options.layout : this.layout;
    var placeholder = options.placeholder || this.placeholder;
    var helpers = options.helpers || this.helpers;
    var partialsDir = options.partialsDir || this.partialsDir;

    var tasks = {view: this.getView.bind(this, filePath, options)};
    if (layout && typeof layout !== 'function') tasks.layout = this.getLayout.bind(this, layout, options);
    if (partialsDir) tasks.partials = this.getPartials.bind(this, partialsDir, options);

    var self = this;
    async.parallel(tasks, function (error, results) {
        if (error) return callback(error);
        var settings = {
            helpers: helpers,
            partials: results.partials,
            data: options.data
        };
        var rendered = results.view(context, settings);
        if (typeof layout === 'function') {
            results.layout = layout;
        }
        if (results.layout) {
            context[placeholder] = rendered;
            rendered = results.layout(context, settings);
        }
        callback(null, rendered);
    });
};

RemoteHandlebars.prototype.getLayout = function (url, options, callback) {
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
        return this.requestTemplate(url, callback);
    }
    this.cache(url.url, this.requestTemplate.bind(this, url), callback);
};

RemoteHandlebars.prototype.getView = function (filePath, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = null;
    }
    filePath = path.resolve(filePath);
    options || (options = {});

    if (!filePath) throw new Error('RemoteHandlebars.getView expects filePath');
    if (!callback) throw new Error('RemoteHandlebars.getView expects callback');

    if (options.cache === false) {
        return this.readTemplate(filePath, callback);
    }
    this.cacheForever(filePath, this.readTemplate.bind(this, filePath), callback);
};

RemoteHandlebars.prototype.getPartials = function (partialsDir, options, callback) {
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
        return this.findTemplates(partialsDir, callback);
    }
    this.cacheForever(partialsDir.join(''), this.findTemplates.bind(this, partialsDir), callback);
};

RemoteHandlebars.prototype.compile = function (template) {
    return this.handlebars.compile(template);
};

RemoteHandlebars.prototype.requestTemplate = function (url, callback) {
    var self = this;
    self.request(url, function (error, response, body) {
        if (error) return callback(error);
        var template = self.compile(body);
        callback(null, template);
    });
};

RemoteHandlebars.prototype.readTemplate = function (filePath, callback) {
    var self = this;
    fs.readFile(filePath, 'utf8', function (error, content) {
        if (error) return callback(error);
        var template = self.compile(content.toString());
        callback(null, template);
    });
};

RemoteHandlebars.prototype.findTemplates = function (paths, callback) {
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
