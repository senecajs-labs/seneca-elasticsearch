/* jshint indent: 2, asi: true, unused: false */
/* global describe, it, before, beforeEach, after, afterEach */
// vim: noai:ts=2:sw=2

var assert         = require('assert');
var elasticsearch  = require('elasticsearch');
var esPlugin       = require('../elasticsearch.js');
var _              = require('underscore');

var seneca = require('seneca')()

seneca.use(esPlugin, {refreshOnSave: true})

describe('elasticsearch', function() {
  var indexName = 'idx1'
  var esClient = new elasticsearch.Client()

  after(function(done) {
    esClient.indices.delete({index: indexName})
    .then(done.bind(null, null))
    .catch(done);
  });

  it('create index', function(done) {
    var cmd = { role: 'search', cmd: 'create-index', index: indexName };

    seneca.act(cmd, throwOnError(done));
  });

  describe('saving', function() {
    var baseCommand = { role: 'search', cmd: 'save', index: indexName, type: 'type1' };

    it('save entity 1', function(done) {
      var command = { data: { id: 'abcd', name: 'caramel' } };
      _.extend(command, baseCommand);
        
      seneca.act(command, throwOnError(done));
    });

    it('save entity 2', function(done) {
      var command = { data: { id: 'caramel', name: 'abcd' } };
      _.extend(command, baseCommand);

      seneca.act(command, throwOnError(done));
    });
  });
});

function throwOnError(done) {
  return function(err) {
    if (err) { throw err; }
    done();
  };
}

