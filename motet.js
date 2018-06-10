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

db._.mixin(lodashId);

db.defaults({ music: [] })
  .write()

function extCheck(filepath) {
    var extname = path.extname(filepath);
    if(extname === '.mp3' || 
        extname === '.flac' || 
        extname === '.ogg' || 
        extname === '.opus') return true;
    
    return false;
}



const items = []; // files, directories, symlinks, etc
var added = 0;

var db_update = false;

function updateDatabase() {
    const excludeDirFilter = through2.obj(function (item, enc, next) {
        if (!item.stats.isDirectory() && extCheck(item.path)) this.push(item);
        next();
      });
    db_update = true;
    klaw('C:\\Users\\ejevi\\Music')
    .pipe(excludeDirFilter)
    .on('data', item => {
        //console.log("Get meta from: " + item.path);
        
        /*
        var someReadStream = fs.createReadStream(item.path);

        mm.parseStream(someReadStream, path.extname(item.path) === '.mp3' ? 'audio/mpeg' : 'audio/flac')
        .then( function (metadata) {
           console.log(util.inspect(metadata, { showHidden: false, depth: null }));
           someReadStream.close();
         });
         */
        
        mm.parseFile(item.path, {skipCovers: true, duration: true})
            .then(meta => {
                //console.log("Meta OK");
                
                var md5 = getMetaHash(meta);
                
                if(!isFileinDb(md5)) {
                    addMusicFileToDb(item, meta, md5);
                    added++;
                    console.log("OK: " + item.path)
                    //console.log("Saved to db");
                } else {
                    //console.log("Already in db");
                }
            })
            .catch(error => {
                //console.log(path.extname(item.path));
                console.log("ERROR: " + item.path) 
                //console.log(error); 
            })
                
        items.push(item.path);
        
        })
    .on('end', () => {db_update = false} );
}

app.get('/', (req, res) => { 
    var options = {
        root: __dirname,
      };
    res.sendFile('index.html', options);
});

app.get('/status', (req, res) => { 
    res.json({"db_update": db_update});
});

app.get('/config/database/update', (req, res) => { 
    res.json({"db_update": true});
    updateDatabase();
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
    var post = isFileinDb(req.params.md5);
    if(post) {
        res.sendFile(post.path);
    } else {
        res.sendStatus(404);
    }    
});

app.get('/queue/:md5', (req, res) => { 
    var post = isFileinDb(req.params.md5);
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

app.listen(3000, () => console.log('Example app listening on port 3000!'));


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

function isFileinDb(md5) {
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