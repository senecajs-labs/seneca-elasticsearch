/* jshint indent: 2, asi: true, unused: false */
/* global describe, it, before, beforeEach, after, afterEach */
// vim: noai:ts=2:sw=2

var assert         = require('assert');
var should         = require('should');
var elasticsearch  = require('elasticsearch');
var _              = require('underscore');

var seneca = require('seneca')();

seneca.use('mem-store',{ map:{ '-/-/foo':'*' }});

seneca.use('..', {
  refreshOnSave: true,
  connection: { index: 'seneca-test' }
});

before(seneca.ready.bind(seneca));

describe('entities', function() {
  var esClient = new elasticsearch.Client();

  after(function(done) {
    esClient.indices.delete({index: 'seneca-test'})
      .then(done.bind(null, null))
      .catch(done);
  });

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
