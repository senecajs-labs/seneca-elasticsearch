/* jshint indent: 2, asi: true, unused: false */
/* global describe, it, before, beforeEach, after, afterEach */
// vim: noai:ts=2:sw=2

var assert         = require('assert');
var should         = require('should');
var elasticsearch  = require('elasticsearch');
var esPlugin       = require('../elasticsearch.js');
var _              = require('underscore');

var seneca = require('seneca')();

seneca.use(esPlugin, {refreshOnSave: true});
seneca.use('mem-store',{ map:{ '-/-/foo':'*' }});

describe('entities', function() {
  before(function() {
    var foo = this.foo = seneca.make$('foo');
    foo.id = 'john doe';
    foo.jobTitle = 'important sounding title';
  });

  it('should save entity', function(done) {
    this.foo.save$(throwOnError(done));
  });

  it('should remove the entity', function(done) {
    this.foo.remove$(this.foo.id, throwOnError(done));
  });
});


function throwOnError(done) {
  return function(err) {
    if (err) { throw err; }
    done();
  };
}
