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

before(seneca.ready.bind(seneca));

describe('indexes', function() {
  var indexName = 'idx1';

  it('create index', function(done) {
    var cmd = { role: 'search', cmd: 'create-index', index: indexName };
    seneca.act(cmd, throwOnError(done));
  });

  it('index exists', function(done) {
    var cmd = { role: 'search', cmd: 'has-index', index: indexName };
    seneca.act(cmd, throwOnError(done));
  });

  it('index delete', function(done) {
    var cmd = { role: 'search', cmd: 'delete-index', index: indexName };
    seneca.act(cmd, throwOnError(done));
  });

});

describe('records', function() {
  var indexName = 'idx2';
  var esClient = new elasticsearch.Client();


  after(function(done) {
    esClient.indices.delete({index: indexName})
      .then(done.bind(null, null))
      .catch(done);
  });

  it('save', function(done) {
    var command = {
      role: 'search',
      cmd: 'save',
      index: indexName,
      type: 'type1'
    };
    command.data = { _id: 'abcd', name: 'caramel' };

    seneca.act(command, throwOnError(done));
  });

  it('load', function(done) {
    var command = {
      role: 'search',
      cmd: 'load',
      index: indexName,
      type: 'type1',
      id: 'abcd'
    };

    seneca.act(command, loadCb);

    function loadCb(err, resp) {
      if (err) { throw err; }
      assert.ok(resp.found);
      should.exist(resp._source);
      should.exist(resp._id);

      resp._id.should.eql('abcd');

      var src = resp._source;
      src._id.should.eql('abcd');
      src.name.should.eql('caramel');

      done();
    }
  });

  it('search', function(done) {
    var command = {
      role: 'search',
      cmd: 'search',
      index: indexName,
      type: 'type1'
    };
    command.data = { id: 'abcd' };

    seneca.act(command, searchCb);

    function searchCb(err, resp) {
      if (err) { throw err; }
      assert.ok(resp.hits);
      resp.hits.total.should.eql(1)

      var result = resp.hits.hits[0]
      should.exist(result._source);
      result._id.should.eql('abcd');
      result._source._id.should.eql('abcd');
      result._source.name.should.eql('caramel');

      done();
    }
  });

  it('remove', function(done) {
    var command = {
      role: 'search',
      cmd: 'remove',
      index: indexName,
      type: 'type1',
      id: 'abcd'
    };
    seneca.act(command, removeCb);

    function removeCb(err, resp) {
      if (err) { throw err; }
      assert.ok(resp.found);
      done();
    }
  });

});

function throwOnError(done) {
  return function(err) {
    if (err) { throw err; }
    done();
  };
}
