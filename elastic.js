const config = require('./config.js');
const elasticsearch = require('elasticsearch');
const client = new elasticsearch.Client({
	 hosts: [ config.elasticdb ]
});

/**
 * Remove all non-array objects from nested array structure... Like removing all attribute objects
 * from a JsonML structure.
 * @param  {JsonML} doc   Array to remove objects from.
 * @return {undefined}    Returns nothing, works by side-effects.
 * @private
 */
function removeObjects(doc) {
	// Iterating backwards, so removing objects from the array won't mess up our indexing.
	for (let i=doc.length-1; i > 0; --i) {
		if (Array.isArray(doc[i])) {
			removeObjects(doc[i]);
		} else if (typeof doc[i] === 'object') {
			doc.splice(i, 1);
		}
	}
}

/**
 * Flatten a JsonML structure, so it becomes one long text string, void of attribute objects and
 * tag names.
 * @param  {JsonML} doc JsonML structure to turn into a string.
 * @return {string}     The string we made!
 * @public
 */
function flattenJsonML(doc) {
	return doc.reduce((str, obj, idx) => {
		// First element is always the tagname, so we remove that.
		if (idx === 0) return str;

		// If what we got here is a string (or somehow a number), we add it as a string.
		if (typeof obj === 'string' || typeof obj === 'number') return str + ' ' + obj;

		// If it's an array, recursion...
		if (Array.isArray(obj)) return str + ' ' + flattenJsonML(obj);

		// Or otherwise we ignore it. (It's going to be an object of attributes).
		return str;
	}, '');
}

/**
 * Extract the contents of the <title> tag in a JsonML document and delete the element itself.
 * @param  {JsonML} doc JsonML to search through.
 * @return {string}     The title string (or undefined if we couldn't find it).
 * @private
 */
function extractAndDeleteTitle(doc) {
	// No document, no title.
	if (!Array.isArray(doc)) return undefined;

	let headIndex;
	for (let i=0, l=doc.length; i < l; ++i) {
		// Found head tag.
		if (Array.isArray(doc[i]) && doc[i][0] === 'head') {
			headIndex = i;
			break;
		}
	}

	// No head, no title.
	if (!headIndex) return undefined;

	// Search through all elements in <head> until we find <title>.
	for (var i=1, l=doc[headIndex].length; i < l; ++i) {
		// Found title tag.
		if (Array.isArray(doc[headIndex][i]) && doc[headIndex][i][0] === 'title') {
			let title;

			// If the first item is a string, that's the title. Otherwise, it's an object of attributes,
			// in which case the second item is the title.
			if (typeof doc[headIndex][i][1] === 'string') {
				title = doc[headIndex][i][1];
			} else {
				title = doc[headIndex][i][2];
			}

			// Remove title from the document.
			doc[headIndex].splice(i, 1);
			return title;
		}
	}

	// Didn't find any title. :(
	return undefined;
}

/**
 * Get plain array of userIds that have permission to view (and search) a document.
 * @param  {JsonML} doc JsonML document with a potential data-auth attribute on the HTML tag.
 * @return {Array}      Array of userIds (username:provider).
 * @private
 */
function extractPermissions(doc) {
	if (doc && doc[0] && doc[0] === 'html' && doc[1] && doc[1]['data-auth']) {
		try {
			const permissions = JSON.parse(doc[1]['data-auth']
				.replace(/'/g, '"')
				.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
			);

			// Find all users with either read or write permissions in the document and return a basic
			// list of userIds (username:provider). E.g. turns an object like:
			//   { username: 'kbadk', provider: 'github', permissions: 'rw' }
			// into the 'kbadk:github'.
			return permissions
				.filter(o => o.permissions.includes('r') || o.permissions.includes('w'))
				.map(o => o.username + ':' + o.provider)
		} catch (error) {
			// If malformed permissions, we grant nobody permission to search. We could grant everybody
			// permission (as if no permissions have been defined), but chances are that wasn't the
			// intention when somebody messed up the permissions.
			return [];
		}
	}

	// If there are no permissions defined, we refer to the config file to see what to do. If
	// config.indexPermissionlessDocuments is set, then we index documents without permissions,
	// otherwise we don't.
	// Indexing everything naturally gives the users more data to search through, but it may also
	// infringe on somebody's privacy. Think twice before indexing everything.
	return config.indexPermissionlessDocuments ? [ 'anonymous:' ] : [];
}

module.exports.insert = (id, doc, ctime, mtime) => {
	// Get permissions from document.
	const permissions = extractPermissions(doc);

	// Get title and delete it from the document, becauase it's annoying when it's part of the
	// 'document summary' when showing search results.
	let title = extractAndDeleteTitle(doc);

	// Turn the JsonML structure into one long string.
	doc = flattenJsonML(doc)

	// Escape HTML.
	doc = doc && doc.replace(/</g, '&lt;');
	title = title && title.replace(/</g, '&lt;');

	// Save in ElasticSearch.
	return client.index({
		index: 'webstrate',
		type: 'doc',
		id: id,
		body: {
			title, doc, permissions, ctime, mtime
		}
	});
};

module.exports.delete = (id) => {
	return client.delete({
		index: 'webstrate',
		type: 'doc',
		id: id
	});
};

module.exports.search = (userId, searchTerm, limit = 25, page = 1, fromDate, toDate) => {
	const oneDayAgo = new Date();
	oneDayAgo.setDate(oneDayAgo.getDate() - 1);
	const oneMonthAgo = new Date();
	oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
	const threeMonthsAgo = new Date();
	threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);

	const query = {
		index: 'webstrate',
		type: 'doc',
		body: {
			query: {
				bool: {
					must: [
						{
							bool: {
								should: [
									{ match: { doc: { query: searchTerm,   boost: 1 } } },
									{ match: { title: { query: searchTerm, boost: 2 } } },
									{ match: { _id: { query: searchTerm,   boost: 2 } } }
								]
							}
						},
						{
							bool: {
								should: [
									{ match: { permissions: 'anonymous:' } }
									// We add the user's userId below; we're not actually sending a 'should' query
									// with just one match criteria.
								]
							}
						},
						{
							bool: {
								should: [
									{ range: { mtime: { gte: +oneDayAgo,      boost: 5 } } },
									{ range: { mtime: { gte: +oneMonthAgo,    boost: 2 } } },
									{ range: { mtime: { gte: +threeMonthsAgo, boost: 1 } } },
									{ range: { mtime: { gte: 0,               boost: 0 } } }
								]
							}
						}
					]
				}
			},
			highlight: {
				pre_tags : ['<strong>'],
				post_tags : ['</strong>'],
				fields: {
					doc: {
						// If we don't get any match on the document (e.g. if match is found in the title), we
						// still want some form of excerpt for the body of the search result. This grabs the
						// first N characters from the doc field.
						no_match_size: 150
					},
					title: {

					}
				},
			},
			size: limit,
		},
		_source: [ 'title', 'permissions', 'ctime', 'mtime' ]
	};

	if (userId) {
		query.body.query.bool.must[1].bool.should.push(
			{ match: { permissions: { query: userId, boost: 3 } } }
		);
	}

	if (limit && page) {
		query.body.from = limit * (page - 1);
	}

	if (toDate || fromDate) {
		query.body.query.bool.must.push({
			bool: {
				should: [
					{ range: { mtime: { gte: +fromDate, lte: +toDate } } },
					{ range: { ctime: { gte: +fromDate, lte: +toDate } } }
				]
			}
		})
	}

	return client.search(query);
};

/**
 * Delete the index, basically wipe the ElasticSearch database.
 * @public
 */
module.exports.deleteIndex = () => {
	return client.indices.delete({
		index: 'webstrate',
	});
};

/**
 * Create a new index and mapping (basically a new database) for ElasticSearch.
 * @public
 */
module.exports.createIndex = () => {
	return client.indices.create({
		index: 'webstrate',
		body: {
			mappings: {
				doc: {
					properties: {
						doc: {
							type: 'text',
							analyzer: 'english'
						},
						title: {
							type: 'text',
							analyzer: 'english'
						},
						ctime: {
							type: 'date',
							format: 'epoch_millis'
						},
						mtime: {
							type: 'date',
							format: 'epoch_millis'
						}
					}
				}
			}
		}
	});
};