let pg = require("pg");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let data = {};
let config = defaultConfigs;

const GOVERNING_ROOM = "trivia"
exports.GOVERNING_ROOM = GOVERNING_ROOM

const GET_USER_SQL = "SELECT users.id, users.username, users.display_name FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 FETCH FIRST 1 ROWS ONLY;";
const INSERT_USER_SQL = "INSERT INTO users (username, display_name) VALUES ($1, $2);";
const INSERT_ALT_SQL = "INSERT INTO alts (username, main_id) VALUES ($1, (SELECT id FROM users WHERE username = $2 FETCH FIRST 1 ROWS ONLY));";


const conInfo = {
	user: mainConfig.dbuser,
	password: mainConfig.dbpassword,
	database: mainConfig.dbname,
	host: mainConfig.dbhost,
	port: mainConfig.dbport
};

let pgReconnect = function(room, user, rank){
	try{
		if(data && data.client){
			data.client.end();
		}
	}catch(e){
		error(e.message);
	}

	try{
		data.client = new pg.Client(conInfo);
		data.client.connect((err)=>{
			if(err){
				error(err);
				if(message){
					room.broadcast(user, "Unable to connect to database.", rank);
				}
			}else{
				ok("Client is connected");
				room.broadcast(user, "The client is now connected to the database.", rank);
				data.connected = true;
			}
		});
		data.client.on("error",(e)=>{
			error(e.message);
		});
		data.client.on("end",()=>{
			data.connected = false;
			error("Client connection ended");
		});
	}catch(e){
		error(e.message);
		if(message){
			room.broadcast(user, "Unable to connect to database.", rank);
		}
	}
};

//This runs a postgres query, handles errors, etc.
let runSql = function(statement, args, onRow, onEnd, onError){
	if(!onError){
		onError = (err)=>{
			error(err);
		};
	}
	if(!data.connected){
		onError("The bot is not connected to the database.");
	}
	try{
		let query = data.client.query(statement,args);
		if(onRow) query.on("row", onRow);
		if(onEnd) query.on("end", onEnd);
		query.on("error", onError);
	}catch(err){
		error(err);
	}
};
exports.runSql = runSql

//Takes a username, returns their ID in the database if it exists. Can also add missing users to the database.
let getId = function(username, createNewEntry, onEnd, onError){
	let res;
	runSql(GET_USER_SQL, [toId(username)], (row)=>{
		res = row;
	}, ()=>{
		if(!res && createNewEntry){
			runSql(INSERT_USER_SQL, [toId(username), removeRank(username)], null, ()=>{
				runSql(INSERT_ALT_SQL, [toId(username), toId(username)], null, ()=>{
					getId(username, createNewEntry, onEnd, onError);
				}, onError);
			}, onError);
		}else{
			onEnd(res);
		}
	}, onError);
}
exports.getId = getId

// onEnd should take a functon of an array with two elements
let getMains = function(username1, username2, createNewEntry, onEnd, onError){
	let res = [];
	getId(username1, createNewEntry, (user1)=>{
		res[0] = user1;
		getId(username2, createNewEntry, (user2)=>{
			res[1] = user2;
			onEnd(res);
		}, onError);
	}, onError);
}
exports.getMains = getMains

exports.onLoad = function(module, loadData, oldData){
	self = module;
	refreshDependencies();
	if(oldData) data = oldData;
	if(loadData){
		try{
			if(data && data.client){
					data.client.end();
			}
		}catch(e){
			error(e.message);
		}

		data = {};

		try{
			data.client = new pg.Client(conInfo);
			data.client.connect((err)=>{
				if(err){
					error(err);
				}else{
					ok("Client is connected");
					data.connected = true;
				}
			});
			data.client.on("error",(e)=>{
				error(e.message);
			});
			data.client.on("end",()=>{
				data.connected = false;
				error("Client connection ended");
			});
		}catch(e){
			error(e.message);
		}
	}
};
exports.onUnload = function(){

};
exports.getData = function(){
	return data;
}
exports.getConfig = function(){
	return config;
}
exports.setConfig = function(newConfig){
	config = newConfig;
}

let refreshDependencies = function(){
};
exports.refreshDependencies = refreshDependencies;

let commands = {
  reconnect: function(message, args, user, rank, room, commandRank, commandRoom){
    if(AuthManager.rankgeq(commandRank,"@")){
      pgReconnect(room, user, rank);
    }
  }
};

self.commands = commands;
exports.commands = commands;

let defaultConfigs = {
	room: ""
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
	room: "string"
};

exports.configTypes = configTypes;
