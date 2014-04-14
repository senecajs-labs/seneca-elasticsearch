/* jshint indent: 2, asi: true, unused: false */
/* global describe, it, before, beforeEach, after, afterEach */
// vim: noai:ts=2:sw=2

var assert         = require('assert');
var should         = require('should');
var elasticsearch  = require('elasticsearch');
var _              = require('underscore');

var seneca = require('seneca')();
var indexName = 'seneca-test-entity';


seneca.use('mem-store',{ map:{ '-/-/foo':'*' }});

seneca.use('..', {
  refreshOnSave: true,
  fields: ['jobTitle'],
  connection: { index: indexName }
});

describe('entities', function() {
  var foo = seneca.make$('foo');
  var fooId = 'john doe';
  var esClient = new elasticsearch.Client();

  after(function(done) {
    esClient.indices.delete({index: indexName})
      .then(done.bind(null, null))
      .catch(done);
  });

  before(function(done) {
    foo.id$ = fooId;
    foo.jobTitle = 'important sounding title';
    foo.passHash = 'DO NOT INDEX!';
    seneca.ready(done);
  });

  it('should save entity', function(done) {
    foo.save$(throwOnError(done));
  });


  it.skip('load', function(done) {

    // need to debounce for 500ms to let the data get indexed.
    _.delay(delayCb, 500);

    function delayCb() {
      var command = {
        role: 'search',
        cmd: 'load',
        index: indexName,
        type: 'foo',
        id: fooId 
      };
      seneca.act(command, loadCb);
    }

    function loadCb(err, resp) {
      if (err) { throw err; }
      assert.ok(resp.exists);
      should.exist(resp._source);

      var src = resp._source;
      src._id.should.eql('john doe');
      src.jobTitle.should.eql('important sounding title');
      should.not.exist(src.passHash);

      done();
    }
  });


  it('should remove the entity', function(done) {
    foo.remove$(fooId, throwOnError(done));
  });
});

function throwOnError(done) {
  return function(err) {
    if (err) { throw err; }
    done();
  };
}
