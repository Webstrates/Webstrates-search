module.exports = {

	// Address of ElasticSearch. Should be a full URL starting with HTTP(S).
	'elasticdb': 'http://localhost:9200',

	// Address of MongoDB. We rely on a replicate set, so this should probably end in `/local` and
	// not `/webstrate` as your Webstrates server.
	'mongodb': 'mongodb://localhost:27017/local',

	// This is the encryption key used in Webstrates. We need this to identify users.
	secret: '',

	// Whether to index webstrates with no `data-auth` property (i.e. no permissions defined).
	// Indexing everything naturally gives the users more data to search through, but it may also
	// infringe on somebody's privacy. Think twice before indexing everything.
	// After changing this value, the user must run
	// `npm run index` to clear the database and reindex the data.
	indexPermissionlessDocuments: false,

};