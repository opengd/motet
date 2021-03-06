const klaw = require('klaw');
const through2 = require('through2');
const path = require('path');
var mm = require('music-metadata');
const util = require('util');

const hasha = require('hasha');

const express = require('express');
const app = express();
var ip = require('ip');

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

var argv = require('minimist')(process.argv.slice(2));

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
        .value()).write();

    db.set('stats.albums', db.get('music')
        .map('album')
        .uniq()
        .size()
        .value()).write();
}

function initStatus() {
    db.set('status.db_update', false).write();
}

function updateDatabase() {

    var timestamp = Date.now();

    db.set('status.db_update', true).write();

    config = low(adapterConfig);

    paths = config.get('music_paths').value();
    keys = Object.keys(paths);

    var nmbMusicPaths = keys.length;

    // Clear the music database, a quick fix to remove any loose entries on update.
    clearMusicDatabase();

    keys.forEach(key => {
        searchpath = paths[key];
        const excludeDirFilter = through2.obj(function (item, enc, next) {
            if (!item.stats.isDirectory() && extCheck(item.path)) this.push(item);
            next();
          });

        console.log("Searching: " + searchpath);
        klaw(searchpath)
        .pipe(excludeDirFilter)
        .on('data', item => {
            prefix_name = key;
            prefix_path = paths[prefix_name];
            mm.parseFile(item.path, {skipCovers: true, duration: true})
                .then(meta => {                
                    // Get the md5 for the meta information.
                    var md5 = getMetaHash(meta, item.path);

                    // Add the new file and meta to the database.
                    addMusicFileToDb(item, meta, md5, timestamp, prefix_name, prefix_path);                    
                })
                .catch(error => {
                    console.log(error);
                    // Get the md5 for the meta information.
                    var md5 = hasha(item.path, {algorithm: 'md5'});

                    // Add as unknown Artist and Album to the database.
                    addUnknowFileToDb(item.path, md5, timestamp, prefix_name, prefix_path);
                })        
            })
        .on('end', () => {
            
            nmbMusicPaths--;
            
            if(nmbMusicPaths == 0) {               
                // Refresh the stats database to reflect the update.
                // Wait a couple of seconds to be sure all files have been processed.
                setTimeout(() => {
                    db.set('status.db_update', false).write();
                    db.set('status.db_update_timestamp', timestamp).write(); 
                    initStats();
                    console.log(getStats());
                    console.log("Database update finish in " + (Date.now() - timestamp)  + "Ms."); 
                }, 2000);
             
            }
        });
    });
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

app.get('/stats', (req, res) => { 
    res.json(getStats());
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
        prefix = config.get('music_paths').value()[post.prefix];
        filepath = post.path;
        if(path.sep == "/") {
            filepath = path.normalize(filepath).replace(/\\/gi, "/");
        }
        console.log("PREFIX: " + prefix);
        console.log(path.normalize(path.join(prefix, filepath)));
        res.sendFile(path.normalize(path.join(prefix, filepath)));
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

function getMetaHash(meta, filepath) {
    var m = meta.common.artist ? meta.common.artist : meta.common.artists[0]; 
    m += meta.common.title +
        meta.common.track.no +
        meta.common.album +
        meta.format.dataformat +
        meta.format.bitrate + 
        meta.format.sampleRate +
        meta.format.numberOfChannels +
        meta.format.duration + 
        filepath;

    return hasha(m, {algorithm: 'md5'});
}

function isFileInDb(md5) {
    const post = db
        .get('music')
        .find({ md5: md5 })
        .value();
    
    return post ? post : false;
}

function addMusicFileToDb(item, meta, md5, timestamp, prefix_name, prefix_path) {
    db.get('music')
        .push({
            "md5": md5,
            "prefix": prefix_name,
            "path": item.path.replace(prefix_path, ""), 
            "artist": meta.common.artist ? meta.common.artist : meta.common.artists[0],
            "title": meta.common.title,
            "track": meta.common.track.no,
            "album": meta.common.album,
            "dataformat": meta.format.dataformat,
            "bitrate": meta.format.bitrate,
            "sampleRate": meta.format.sampleRate,
            "numberOfChannels": meta.format.numberOfChannels,
            "duration": meta.format.duration,
            "db_timestamp": timestamp
        })
        .write();
}

function addUnknowFileToDb(filepath, md5, timestamp, prefix_name, prefix_path) {

    var tracks = db.get('music')
        .filter({artist: "Unknown", album: "Unknown"})
        .size()
        .value();

    var dataformat = path.extname(filepath).slice(1);

    db.get('music')
        .push({
            "md5": md5,
            "prefix": prefix_name,
            "path": filepath.replace(prefix_path, ""),   
            "artist": "Unknown",
            "title": path.basename(filepath),
            "track": tracks,
            "album": "Unknown",
            "dataformat": dataformat,
            "bitrate": 0,
            "sampleRate": 0,
            "numberOfChannels": 0,
            "duration": 0,
            "db_timestamp": timestamp
        })
        .write();
}

function updateDbTimestamp(md5, timestamp) {
    db.get('music')
        .find({ md5: md5 })
        .assign({ db_timestamp: timestamp})
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

function clearMusicDatabase() {
    return db.set('music', []).write();
}

var cfg_name = "config.json";

if(argv.config) cfg_name = argv.config;

const adapterConfig = new FileSync(cfg_name);
var config = low(adapterConfig);

config.defaults({port: 3000, address: "", music_paths: [], name: "Motet", db_name: "db.json"})
    .write();

const adapter = new FileSync(config.get("db_name").value());
const db = low(adapter);

db.defaults({ music: [], status: {}, stats: {} })
    .write();

console.log("Init stats.");
initStats();
console.log(getStats());
console.log("Init status.");
initStatus();
console.log(getStatus());
console.log("Config:");
console.log(config.value());

paths = config.get('music_paths').value();

console.log(paths + Object.keys(paths).length);

Object.keys(paths).forEach(key => {
    console.log(key  + ":" + paths[key]);
});

if(config.get('address').value() && config.get('address').value().length > 0) {
    app.listen(config.get('port').value(), config.get('address').value(), (e) => { 
        console.log('Please open http://' + 
            config.get('address').value() + ":" + 
            config.get('port').value() + 
            " in Google Chrome.");
    }).on('error', (e) => {
        if(e.code == 'EADDRINUSE') {
            console.log("Error: Could start server on port " + config.get('port').value() + ", please check if the port is already in use.")
        } else { 
            console.log(e);
        }
    });
} else {
    app.listen(config.get('port').value(), (e) => { 
        console.log('Please open http://' + 
            ip.address() +
            ":" + config.get('port').value() + 
            " in Google Chrome.");
    }).on('error', (e) => {
        if(e.code == 'EADDRINUSE') {
            console.log("Error: Could start server on port " + config.get('port').value() + ", please check if the port is already in use.")
        } else { 
            console.log(e);
        }
    });
} 
