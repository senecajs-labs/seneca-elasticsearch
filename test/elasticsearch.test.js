/* jshint indent: 2, asi: true, unused: false */
/* global describe, it, before, beforeEach, after, afterEach */
// vim: noai:ts=2:sw=2

var assert         = require('assert');
var elasticsearch  = require('elasticsearch');
var esPlugin       = require('../elasticsearch.js');
var _              = require('underscore');

var seneca = require('seneca')();

seneca.use(esPlugin, {refreshOnSave: true});

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

  before(function(done) {
    esClient.indices.create({index: indexName})
      .then(done.bind(null, null))
      .catch(done);
  });

  after(function(done) {
    esClient.indices.delete({index: indexName})
      .then(done.bind(null, null))
      .catch(done);
  });

  it('save', function(done) {
    var command = { role: 'search', cmd: 'save', index: indexName, type: 'type1' };
    command.data = { id: 'abcd', name: 'caramel' };
      
    seneca.act(command, throwOnError(done));
  });

});

function throwOnError(done) {
  return function(err) {
    if (err) { throw err; }
    done();
  };
}
