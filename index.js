'use strict';
const config = require('./config.js')

/**
 * This part takes care of all changes to MongoDB and puts them in ElasticSearch.
 */
const elastic = require('./elastic.js');
const MongoOplog = require('mongo-oplog');
const oplog = MongoOplog(config.mongodb, { ns: 'webstrate.webstrates' });

oplog.tail();

oplog.on('insert', (data) =>
	elastic.insert(data.o._id, data.o._data, data.o._m.ctime, data.o._m.mtime));

oplog.on('update', (data) =>
	elastic.insert(data.o._id, data.o._data, data.o._m.ctime, data.o._m.mtime));

oplog.on('delete', (data) =>
	elastic.delete(data.o._id));

/**
 * And this here is our search HTTP API.
 */
const express = require('express');
const sessions = require('client-sessions');
const app = express();

if (!config.secret) {
	console.error(`Error: 'secret' must be defined in config.js.`);
	process.exit(9)
}

app.use(sessions({ secret: config.secret, cookieName: 'session' }));

app.get('/', async (req, res) => {
	res.header('Access-Control-Allow-Origin', '*');

	const query = req.query.q;
	const limit = Number(req.query.l) || 10;
	const page = Number(req.query.p) || undefined;
	const fromDate = req.query.fromDate && new Date(req.query.fromDate);
	const toDate = req.query.toDate && new Date(req.query.toDate);

	const userId = req.session && req.session.passport && req.session.passport.user;
	console.log({ userId, query, limit, page });

	if (!query) return res.json({ error: 'No query, use /?q=<query>.' });

	const response = await elastic.search(userId, query, limit, page, fromDate, toDate);

	return res.json(response);
});

app.listen(7010);