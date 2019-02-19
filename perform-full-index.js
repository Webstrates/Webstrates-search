const mongodb = require('mongodb');
const MongoClient = require('mongodb').MongoClient;
const elastic = require('./elastic.js');

!async function() {

	const client = await MongoClient.connect('mongodb://localhost:27017/', { useNewUrlParser: true });
	console.log("Connected successfully to server");

	const db = client.db('webstrate');
	const webstrates = db.collection('webstrates');

	// Delete existing index (basically wipe the database).
	try {
		await elastic.deleteIndex();
	} catch (error) {
		// If we get a 404, it just means the index doesn't exist, which is what we were trying to
		// accomplish anyway.
		if (error.status !== 404) {
			console.error(error);
		}
	}

	// Create index including mapping (bascically a new database).
	try {
		await elastic.createIndex();
	} catch (error) {
		console.error('Unable to create index and mapping')
	}

	const docs = webstrates.find().sort({ _id: 1 });
	const count = await docs.count();
	console.log(`Found ${count} documents.`);

	const failures = [];
	let i = 1;
	while (await docs.hasNext()) {
		const doc = await docs.next();

		try {
			await elastic.insert(doc._id, doc._data, doc._m.ctime, doc._m.mtime);
			console.log(`[${i}/${count}] SUCCESS ${doc._id}`);
		} catch (error) {
			failures.push([doc._id, error.message]);
			console.error(`[${i}/${count}] FAILED  ${doc._id}`);
		}

		++i;
	}

	console.log(`The following ${failures.length} documents failed:`)
	failures.forEach(([id, error]) => {
		console.log(`${id}: ${error}`);
	});

	client.close();
}();