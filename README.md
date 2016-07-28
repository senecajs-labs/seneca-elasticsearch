![SenecaLogo][]

# seneca-elasticsearch

elastic search plugin to [Seneca][]

This plugin will automatically index any entities that are being saved.
Only entities will have their fields filtered by options.fields, the
rest of the api assumes you know what you are doing.

## Setup

```JavaScript

var seneca = require('seneca')({
  strict: { // needed for seneca 0.6.4+
    add: false
  }
});

// important to use a store definition BEFORE including this module
// to automatically index entities
seneca.use('mem-store',{ map:{ '-/-/foo':'*' }});

seneca.use('seneca-elasticsearch', {
  fetchEntitiesFromDB: true, // only enable if you depend on this for permissions.
  refreshOnSave: true, // never enable this if your code needs to run in production.
  entities: [{
	name: 'foo',
	indexedAttributes: { // define mapping to be imported
	  someField: {
		type: 'string',
		index: 'not_analyzed'
	  }
	}
  }],

  connection: { index : indexName }, // customize index name
  pingTimeout: 1000
});

seneca.ready(function(err) {
    if (err) { return console.log(err); }

    // your code here.
    // It will have created the index for you automatically.

});
```


## Index management api

```JavaScript
// check for index
seneca.act({role: 'search', cmd: 'create-index', index: 'myIndex'}, callback);

// create an index (checks first)
seneca.act({role: 'search', cmd: 'create-index', index: 'myIndex'}, callback);

// delete an index (checks first)
seneca.act({role: 'search', cmd: 'delete-index', index: 'myIndex'}, callback);
```

## Record management api

```JavaScript
// index or update a record
seneca.act({
    role: 'search',
    cmd: 'save',
    index: 'myIndex',
    type: 'myType',
    id: 'myId', // requires either this id
    data: {
        _id: 'myId', // or this id
        /*  rest of object here */
    }
}, callback);

// remove a record
seneca.act({
    role: 'search',
    cmd: 'remove',
    index: 'myIndex',
    type: 'myType',
    id: 'myId'
}, callback);


// load a record
seneca.act({
    role: 'search',
    cmd: 'load',
    index: 'myIndex',
    type: 'myType',
    id: 'myId'
}, callback);
```

## Search api

```JavaScript
// return all records
seneca.act({
    role: 'search',
    cmd: 'search',
    index: 'myIndex',
    type: 'myType'
}, callback);

// match lucene query string
seneca.act({
    role: 'search',
    cmd: 'search',
    index: 'myIndex',
    type: 'myType',
    search: "query string here",
    
}, callback);


// match elasticsearch JSON query

// TODO: 
// See tests/search.js for more about this.
// This is most likely what you will want
// to be using.
```

## Testing

By default this library maintains a connection to ElasticSearch using a keepAlive.  If you use this library as part of your own plugin,  depending on the testing library you employ it's possible that your tests never complete because the connection is held open.  To disable the keepAlive, do: 

````js
connection:  {
  keepAlive: false,  // NEEDED FOR TESTS ONLY
  sniffInterval: 0   // NEEDED FOR TESTS ONLY
}
````


## Contributing

The [Senecajs org][] encourage open participation. If you feel you can help in any way, be it with documentation, examples, extra testing, or new features please get in touch.

## License

Copyright Adrian Rossouw and other contributors 2014 - 2016, Licensed under [MIT][].

[SenecaLogo]: https://camo.githubusercontent.com/4a0178ff2abf26f9214d4d98bc23eec356ced357/687474703a2f2f73656e6563616a732e6f72672f66696c65732f6173736574732f73656e6563612d6c6f676f2e706e67
[Seneca]: http://senecajs.org/
[Senecajs org]: https://github.com/senecajs/
[MIT]: ./LICENSE.txt
