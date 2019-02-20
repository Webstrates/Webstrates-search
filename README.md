# Search Backend

Search is a small daemon that continuously indexes your Webstrates server while providing an HTTP API for searching through all webstrates. In order to do so, Search eavesdrops on the [MongoDB Replica Set Oplog](https://docs.mongodb.com/manual/core/replica-set-oplog/) and propagates any changes detected to the documents to the underlying ElasticSearch database. The HTTP API allows you to search through these documents directly or by building applications on top of the HTTP API (like our [example search frontend](https://github.com/Webstrates/search-frontend)).

Before installing the Search Backend, you'll need:

- A functioning Webstrates installation and accompanying MongoDB datbaase.
- NodeJS (version 8 or later), which you should already have as a result of the above requirement.
- ElasticSearch (version 6) ([ElasticSearch Installation Guide](https://www.elastic.co/guide/en/elasticsearch/reference/current/deb.html).
- MongoDB configured with a Replica Set Oplog, [see below](https://github.com/Webstrates/search-backend#setting-up-mongodb-replica-set-on-ubuntu).

To install:

- Clone this repository with `git` or [download a ZIP of the source code](https://github.com/Webstrates/search-backend/archive/master.zip) and unzip it.
- Navigate to the repository root.
- Edit `config.js` and change the `secret` value to the same value as `auth->cookie->secret` in `config.json` in your Webstrates installation.
- Run the following from the root directory:
```
npm install --production # Installs required NPM packages
npm run index # Index all existing webstrates, this may take a a few minutes.
npm start # Starts Search Backend
```

The HTTP API should now be running at [http://localhost:7010/](http://localhost:7010/). It accepts 3 explicit GET parameters: `q` (for query), `l` (for limit) and `p` (for page), e.g. a request to [http://localhost:7010/?q=cat&l=5&p=2](http://localhost:7010/?q=cat&l=5&p=2) will return 5 documents matching the word "cat", starting from result 6 and onwards. `l` and `p` are optional, `q` is not. Lastly, one implicit parameter is used when performing the search, namely the searchee's webstrates `userId` (something like `kbadk:github`). This will be extracted from the user's cookie automatically (with help from the `secret` value defined in `config.js`) and injected in to the query to ensure the user doesn't get back results from documents which the user has no permissions to view.

To ensure that Search is always running, you can either [set up a Linux service with `systemd`](https://medium.com/@benmorel/creating-a-linux-service-with-systemd-611b5c8b91d6) or [use something like `forever`](https://www.npmjs.com/package/forever).

## Setting up MongoDB Replica Set on Ubuntu

In order for Search to know when a document has changed (so it can reindex the document), we need to setup a [MongoDB Replica Set Oplog](https://docs.mongodb.com/manual/core/replica-set-oplog/). This Oplog allows the Search Backend to subscribe to document changes and immediately have ElasticSearch reindex the changed document, ensuring users never get back stale search results.

Enabling the oplog:

- Open the MongoDb configuration file (`nano /etc/mongod.conf`).
- Add (or uncomment) the following from the file:
```
replication:
  replSetName: rs0
```
- Restart MongoDB.
- Start the Mongo shell (write `mongo`).
- Write `rs.initiate()`.
- Close the shell.

Your replica set should now be up and running.

(We call our replicate set `rs0` (for replica set 0), but you may name it whatever you want.)

## Setting up NGINX reverse proxy

When trying to build a search frontend (or using our [example search frontend](https://github.com/Webstrates/search-frontend)), you may notice that the `userId` is absent from the search query in the console output of the Search Backend. This is due to [CORS restrictions](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS): When your browser is making a request using [`fetch()`](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API) (or similar) to [http://localhost:7010/](http://localhost:7010/) from [http://localhost:7007/](http://localhost:7010/) (or any other URL that share host and port with the origin of the request for that matter), the request gets stripped of cookies by the browser for security reasons. As a result, the search will not return "restricted" documents (i.e. documents the searching user has access to, but not everybody else has. Otherwise, strangers would be able to search through your private documents).

To fix this problem, it's recommended to run Search behind an NGINX proxy along with Webstrates. (This also makes setting up HTTPS for both Webstrates and Search easier.)
If Webstrates isn't already running behind NGINX, check out our [Guide on setting up Webstrates using SSL on Ubuntu](https://github.com/Webstrates/Webstrates/wiki/Setup-Webstrates-using-SSL-on-a-Ubuntu-16.04-(Xenial-Xerus)).

After following that guide, your Webstrate server should now be available on [http://localhost:80/](http://localhost:80/). Setting up a reverse proxy for Search is now trivial:

- Open your NGINX config file (`sudo nano /etc/nginx/sites-available/webstrates`).
- Add the following under the `server` section:
```
location /_search {
    proxy_pass http://localhost:7010/;
}
```
- Restart NGINX (`sudo service nginx restart`).

The HTTP API that was previously available on [http://localhost:7010/](http://localhost:7010/) should now be available at [http://localhost:80/_search](http://localhost:80/_search) and cookies will seemlessly be passed on to HTTP API requests (as you will not be making requests across different ports anymore).

## FAQ

**When running `npm run index`, the output tells me that "The following N documents failed". Why?**

The MongoDB database may have some corrupt Webstrates documents that Search has failed to index. This is generally expected on a Webstrates server with a lot of documents, and unless the documents that failed to index are important, this is not an issue to worry about.

**Wait, so can anybody just search through my documents?**

No, by default, Search looks at your `userId` and only shows you documents in which your `userId` (or the `userId` `anonymous:`) explicitly has been granted access to read or write in the permissions attribute (`data-auth`). If the document's `data-auth` attribute is malformed, it won't be indexed. Likewise, if the document has no permissions defined, it also won't be indexed. However, if the `indexPermissionlessDocuments` option in the configuration file (`config.js`) is set to `true` (and the database gets reindexed), documents without the `data-auth` attribute (i.e. without permissions) will indeed be indexed and show up in all users' search results. Think twice before doing this as it may infringe on somebody's privacy. Regardless of configuration, documents with malformed `data-auth` properties will never be indexed.

**Why is `userId` undefined (or why does my private documents not show up in my search results)**?

If after peforming a search, the `userId` is undefined in Search's console output, it's probably because either:

- You're simply not logged in on the Webstrates server. Navigate to your Webstrates server, open the DevTools and ensure that `webstrate.user` contains your user object. Log in again.
- Search has failed to decrypt the cookie, because the `secret` defined in the config file does not correspond verbatum to the secret defined in the Webstrates config file. Fix the key.
- You're making the request programmatically and CORS restrictions are kicking in. [Put Search behind an NGINX reverse proxy with Webstrates](https://github.com/Webstrates/search-backend#setting-up-nginx-reverse-proxy).

**Do I have to run `npm run index` more than once?**

Not really, but maybe. When running `npm run index`, every document gets indexed as it is. When Search is running, it monitors changes to all documents. Whenever a document is changed, it gets reindexed. Therefore, as long as Search is running when Webstrates is, the newest version of the document is always the one that will be in the index (and thus searchable). However, if Search hasn't been running for a long time and is then started, the search results may be out of date. To fix this, you could re-run `npm run index` to bring the index up to date. Alternatively, you could just wait as eventually the documents will come up to date again as users modify them and Search reindexes this.

In fact, you could _not_ run `npm run index` at all, and thus only documents that are modified after Search has been setup will be indexed.

**Can I (re-)index while Search is running?**

Yes. Performance may be degraded, but it is still recommended as the database may otherwise already be out of date by the time the indexing finishes.