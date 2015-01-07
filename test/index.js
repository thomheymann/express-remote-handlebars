'use strict';

var path = require('path');
var remoteHandlebars = require('..');
var nock = require('nock');

describe('RemoteHandlebars', function () {
    beforeEach(function () {
        nock.cleanAll();

        this.defaultLayoutMock = nock('http://mocked')
        .get('/layouts/default')
        .replyWithFile(200, path.resolve(__dirname, 'fixtures/views/layouts/default.handlebars'));

        this.strippedLayoutMock = nock('http://mocked')
        .get('/layouts/stripped')
        .replyWithFile(200, path.resolve(__dirname, 'fixtures/views/layouts/stripped.handlebars'));
    });

    describe('.constructor()', function () {
        it('should expose simple factory', function () {
            remoteHandlebars()
            .should.be.a.Function;
        });

        it('should expose advanced factory', function () {
            remoteHandlebars.create().engine
            .should.be.a.Function;
        });

        it('should expose constructor', function () {
            new remoteHandlebars.RemoteHandlebars().engine
            .should.be.a.Function;
        });
    });

    describe('.render()', function () {
        it('should render view with layout', function (done) {
            var view = path.resolve(__dirname, 'fixtures/views/index.handlebars');
            var partialsDir = path.resolve(__dirname, 'fixtures/views/partials');
            var layout = 'http://mocked/layouts/default';
            remoteHandlebars.create({partialsDir: partialsDir, layout: layout})
            .render(view, {}, function (error, rendered) {
                if (error) return done(error);

                rendered
                .should.containEql('<body>')
                .and.containEql('<article>');

                done();
            });
        });

        it('should allow rendering without layout', function (done) {
            var view = path.resolve(__dirname, 'fixtures/views/index.handlebars');
            var partialsDir = path.resolve(__dirname, 'fixtures/views/partials');
            remoteHandlebars.create({partialsDir: partialsDir, layout: false})
            .render(view, {}, function (error, rendered) {
                if (error) return done(error);

                rendered
                .should.not.containEql('<body>')
                .and.containEql('<article>');

                done();
            });
        });

        it('should override defaults', function (done) {
            var view = path.resolve(__dirname, 'fixtures/views/index.handlebars');
            var partialsDir = path.resolve(__dirname, 'fixtures/views/partials');
            var layout = 'http://mocked/layouts/default';
            remoteHandlebars.create({partialsDir: partialsDir, layout: layout})
            .render(view, {
                layout: 'http://mocked/layouts/stripped'
            }, function (error, rendered) {
                if (error) return done(error);

                rendered
                .should.containEql('<body>')
                .and.not.containEql('<nav>')
                .and.containEql('<article>');

                done();
            });
        });
    });

    describe('.getLayout()', function () {
        it('should fetch template from remote', function (done) {
            var test = this;

            remoteHandlebars.create()
            .getLayout('http://mocked/layouts/default', function (error, template) {
                if (error) return done(error);

                // Ensure there are no more pending mocks
                test.defaultLayoutMock.isDone().should.be.true;

                done();
            });
        });

        it('should cache template', function (done) {
            var test = this;

            var instance = remoteHandlebars.create({layout: 'http://mocked/layouts/default'});
            instance.getLayout(function (error, template) {
                if (error) return done(error);

                // Ensure there are no more pending mocks
                test.defaultLayoutMock.isDone().should.be.true;

                // 2nd request should use cache (This would fail if response wasn't cached)
                instance.getLayout(done);
            });
        });

        it('should allow disabling cache', function (done) {
            var test = this;

            var layout = 'http://mocked/layouts/default';
            var uncached = {cache: false};
            var instance = remoteHandlebars.create();
            instance.getLayout(layout, uncached, function (error, template) {
                if (error) return done(error);

                // Ensure there are no more pending mocks
                test.defaultLayoutMock.isDone().should.be.true;

                // 2nd request should fail without pending mocks if cache is disabled
                instance.getLayout(layout, uncached, function (error, template) {
                    done(error ? undefined : new Error('Template was cached despite being disabled'));
                });
            });
        });
    });

    describe('.getView()', function () {
        it('should read template from disk', function (done) {
            remoteHandlebars.create()
            .getView(path.resolve(__dirname, 'fixtures/views/index.handlebars'), done);
        });
    });

    describe('.getPartials()', function () {
        it('should accept single path', function (done) {
            remoteHandlebars.create()
            .getPartials(path.resolve(__dirname, 'fixtures/views/partials'), done);
        });

        it('should accept list of paths', function (done) {
            remoteHandlebars.create()
            .getPartials([path.resolve(__dirname, 'fixtures/views/partials'), path.resolve(__dirname, 'fixtures/views/more-partials')], done);
        });

        it('should read all .handlebars and .hbs templates', function (done) {
            remoteHandlebars.create()
            .getPartials(path.resolve(__dirname, 'fixtures/views/partials'), function (error, partials) {
                if (error) done(error);

                partials
                .should.have.property('sidebar');

                done();
            });
        });

        it('should read folders recursively', function (done) {
            remoteHandlebars.create()
            .getPartials(path.resolve(__dirname, 'fixtures/views/more-partials'), function (error, partials) {
                if (error) done(error);

                partials
                .should.have.property('nested/partial');

                done();
            });
        });

        it('should override partials with same name in order of paths', function (done) {
            remoteHandlebars.create()
            .getPartials([path.resolve(__dirname, 'fixtures/views/partials'), path.resolve(__dirname, 'fixtures/views/more-partials')], function (error, partials) {
                if (error) done(error);

                partials
                .should.have.properties('sidebar', 'nested/partial');

                partials.sidebar({links: [1, 2, 3]})
                .should.containEql('<ol>')
                .and.not.containEql('<ul>')

                done();
            });
        });
    });

    describe('.compile()', function () {
        it('should return compiled handlebars template', function () {
            var template = remoteHandlebars.create().compile('<main>{{{content}}}</main>');
            var rendered = template({content: '<p>Content</p>'});
            rendered.should.equal('<main><p>Content</p></main>');
        });
    });
});
