/* jshint indent: 2, asi: true, unused: false */
/* global describe, it, before, beforeEach, after, afterEach */
// vim: noai:ts=2:sw=2

var assert         = require('assert');
var should         = require('should');
var elasticsearch  = require('elasticsearch');
var bulkFixture    = require('./fixtures/bulk.json');
var _              = require('underscore');

var seneca = require('seneca')();


seneca.use('..', {
  refreshOnSave: true,
  connection: { index: 'seneca-search-test' }
});

before(seneca.ready.bind(seneca));
describe('search', function() {
  var esClient = new elasticsearch.Client();
  var pin = seneca.pin({role: 'search', cmd: '*'});
  var indexName = 'seneca-search-test';

  before(function(done) {
    esClient.bulk({body: bulkFixture})
      .then(done.bind(null, null))
      .catch(done);
  });

  it('can match all results', function(done) {
    var command = { index: indexName, type: 'foobar', data: {} };

    pin.search(command, searchCb);

    function searchCb(err, resp) {
      if (err) { throw err; }
      console.log(resp);
      assert.ok(resp.hits);
      resp.hits.total.should.eql(1)

      var result = resp.hits.hits[0]
      should.exist(result._source);
      result._source.id.should.eql('abcd');
      result._source.name.should.eql('caramel');

      done();
    }

  });
/*
  after(function(done) {
    esClient.indices.delete({index: 'seneca-search-test'})
      .then(done.bind(null, null))
      .catch(done);
  });
*/
});

function throwOnError(done) {
  return function(err) {
    if (err) { throw err; }
    done();
  };
}

