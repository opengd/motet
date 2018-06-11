const klaw = require('klaw');
const through2 = require('through2');
const path = require('path');
var mm = require('music-metadata');
const util = require('util');

const hasha = require('hasha');

const express = require('express')
const app = express()

const lodashId = require('lodash-id');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
 
const adapter = new FileSync('db.json');
const db = low(adapter);

const internalIp = require('internal-ip');

db._.mixin(lodashId);

db.defaults({ music: [], status: {}, stats: {} })
  .write()

function extCheck(filepath) {
    var extname = path.extname(filepath);
    if(extname === '.mp3' || 
        extname === '.flac' || 
        extname === '.ogg' || 
        extname === '.opus') return true;
    
    return false;
}

function initStats() {
    db.set('stats.songs', db.get('music')
    .size()
    .value()).write();

    db.set('stats.artist', db.get('music')
    .map('artist')
    .uniq()
    .size()
    .value());

    db.set('stats.albums', db.get('music')
    .map('albums')
    .uniq()
    .size()
    .value());
}

function initStatus() {
    db.set('status.db_update', false).write();
}

function updateDatabase() {
    const excludeDirFilter = through2.obj(function (item, enc, next) {
        if (!item.stats.isDirectory() && extCheck(item.path)) this.push(item);
        next();
      });
    db.set('status.db_update', true).write();
    klaw('C:\\Users\\ejevi\\Music')
    .pipe(excludeDirFilter)
    .on('data', item => {
        mm.parseFile(item.path, {skipCovers: true, duration: true})
            .then(meta => {                
                // Get the md5 for the meta information
                var md5 = getMetaHash(meta);
                
                // Get the post if it exist in the database already
                var post = isFileInDb(md5);
                
                if(!post) {
                    // Add the new file and meta to the database.
                    addMusicFileToDb(item, meta, md5);

                    db.set('stats.songs', db.get('stats.songs')
                    .value() + 1).write();
                    
                    console.log("OK: " + item.path)
                } else {
                    // If the filepath is not equal to the post already in database
                    // then update the filepath to use the new one.
                    if(post.file != item.path) updateFilePath(md5, item.path);
                }
            })
            .catch(error => {
                console.log("ERROR: " + item.path);
                var hash = hasha(item.path, {algorithm: 'md5'});
                console.log("ADD as Unknown: " + item.path);
                addUnknowFileToDb(item.path, hash);
            })        
        })
    .on('end', () => {db.set('status.db_update', false).write();} );
}

app.get('/', (req, res) => { 
    var options = {
        root: __dirname,
      };
    res.sendFile('index.html', options);
});

app.get('/status', (req, res) => { 
    res.json(getStatus());
});

app.get('/config/database/update', (req, res) => {

    if(!db.get('status.db_update').value()) {
        db.set('status.db_update', true).write();  
        updateDatabase();
    }

    res.json(db.get('status').value());
});

app.get('/list', (req, res) => { 
    res.json(db.get('music').value());
});

app.get('/artists', (req, res) => { 
    res.json(db.get('music')
        .map('artist')
        .uniq()
        .sort()
        .value());
});

app.get('/artist/:artist', (req, res) => { 
    console.log(req.params.artist);
    console.log(db.get('music')
    .filter({artist: req.params.artist})
    .map('album')
    .uniq()
    .sort()
    .value());

    res.json(db.get('music')
    .filter({artist: req.params.artist})
    .map('album')
    .uniq()
    .sort()
    .value());
});

app.get('/artist/:artist/album/:album', (req, res) => {     
    res.json(db.get('music')
    .filter({artist: req.params.artist, album: req.params.album})
    .sortBy('track')
    .value());
});

app.get('/albums', (req, res) => { 
    res.json(db.get('music')
    .map('album')
    .uniq()
    .sort()
    .value());
});

app.get('/music/:md5', (req, res) => { 
    var post = isFileInDb(req.params.md5);
    if(post) {
        res.sendFile(post.path);
    } else {
        res.sendStatus(404);
    }    
});

app.get('/queue/:md5', (req, res) => { 
    var post = isFileInDb(req.params.md5);
    if(post) {

        var songs = db.get('music')
        .filter({artist: post.artist, album: post.album})
        .sortBy('track')
        .value();

        console.log(songs.drop(songs.findIndex(o => o.md5 == req.params.md5)));

        res.json(songs.drop(songs.findIndex(o => o.md5 == req.params.md5)));
        //res.sendFile(post.path);
    } else {
        res.sendStatus(404);
    }    
});

console.log("Init stats.");
initStats();
console.log("Init status.");
initStatus();

var sssd = app.listen(3000, () => { 
    internalIp.v4().then(ip => {
        console.log('Please open http://' + ip + ":3000 in Google Chrome.");
    });   
});

function getMetaHash(meta) {
    var m = meta.common.artist ? meta.common.artist : meta.common.artists[0]; 
    m += meta.common.title +
        meta.common.track.no +
        meta.common.album +
        meta.format.dataformat +
        meta.format.bitrate + 
        meta.format.sampleRate +
        meta.format.numberOfChannels +
        meta.format.duration;

    return hasha(m, {algorithm: 'md5'});
}

function isFileInDb(md5) {
    const post = db
        .get('music')
        .find({ md5: md5 })
        .value();
    
    return post ? post : false;
}

function addMusicFileToDb(item, meta, md5) {
    db.get('music')
    .push({
        "md5": md5,  
        "path": item.path, 
        "artist": meta.common.artist ? meta.common.artist : meta.common.artists[0],
        "title": meta.common.title,
        "track": meta.common.track.no,
        "album": meta.common.album,
        "dataformat": meta.format.dataformat,
        "bitrate": meta.format.bitrate,
        "sampleRate": meta.format.sampleRate,
        "numberOfChannels": meta.format.numberOfChannels,
        "duration": meta.format.duration
    })
    .write();
}

function addUnknowFileToDb(filepath, md5) {

    var tracks = db.get('music')
    .filter({artist: "Unknown", album: "Unknown"})
    .size()
    .value();

    var dataformat = path.extname(filepath).slice(1);

    db.get('music')
    .push({
        "md5": md5,  
        "path": filepath, 
        "artist": "Unknown",
        "title": filepath,
        "track": tracks,
        "album": "Unknown",
        "dataformat": dataformat,
        "bitrate": 0,
        "sampleRate": 0,
        "numberOfChannels": 0,
        "duration": 0
    })
    .write();
}

function updateFilePath(md5, filepath) {
    db.get('music')
        .find({ md5: md5 })
        .assign({ path: filepath})
        .write();
}

function getStatus() {
    return db.get('status').value();
}

function getStats() {
    return db.get('stats').value();
}