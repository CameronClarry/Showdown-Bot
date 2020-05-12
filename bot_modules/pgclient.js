let pg = require("pg");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let data = {};
let config = defaultConfigs;

const GOVERNING_ROOM = "trivia"
exports.GOVERNING_ROOM = GOVERNING_ROOM

const GET_USER_SQL = "SELECT users.id, users.username, users.display_name FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 FETCH FIRST 1 ROWS ONLY;";
const INSERT_USER_SQL = "INSERT INTO users (username, display_name) VALUES ($1, $2);";
const INSERT_ALT_SQL = "INSERT INTO alts (username, main_id) VALUES ($1::VARCHAR, (SELECT id FROM users WHERE username = $1::VARCHAR FETCH FIRST 1 ROWS ONLY));";


const conInfo = {
	user: mainConfig.dbuser,
	password: mainConfig.dbpassword,
	database: mainConfig.dbname,
	host: mainConfig.dbhost,
	port: mainConfig.dbport
};

//TODO this should no be dealing with rooms, users, and ranks. simply a callback.
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
let runSql = function(statement, args, callback){
	if(!callback){
		callback = (err) => {if (err) error(err);};
	}
	if(!data.connected){
		callback("The bot is not connected to the database.");
	}
	try{
		let queryConfig = {
			text: statement,
			values: args
		};
		let query = data.client.query(queryConfig, callback);
	}catch(err){
		callback(err);
	}
};
exports.runSql = runSql;



let runSqlAsArray = function(statement, args, callback){
	if(!callback){
		callback = (err) => {if (err) error(err);};
	}
	if(!data.connected){
		callback("The bot is not connected to the database.");
	}
	try{
		let queryConfig = {
			text: statement,
			values: args,
			rowMode: 'array'
		};
		let query = data.client.query(queryConfig, callback);
	}catch(err){
		callback(err);
	}
};
exports.runSqlAsArray = runSqlAsArray

//Takes a username, returns their entry in the users table if it exists. Can also add missing users to the database.
// TODO find all references to this, and make the callback something more descriptive than 'res'
let getUser = function(username, createNewEntry, callback){
	let newCallback = (err, res)=>{
		if(err){
			callback(err);
			return;
		}
		if(res.rowCount === 0 && createNewEntry){
			let newEntryCallback = (err, res)=>{
				if(err){
					callback(err, res);
					return;
				}
				getUser(username, createNewEntry, callback);
			};
			runSql(INSERT_USER_SQL, [toId(username), removeRank(username)], (err, res)=>{
				if(err){
					callback(err);
					return;
				}
				runSqlAsArray(INSERT_ALT_SQL, [toId(username)], newEntryCallback);
			});
		}else{
			callback(null, res.rows[0]);
		}
	}
	runSql(GET_USER_SQL, [toId(username)], newCallback);
	/*
	runSql(GET_USER_SQL, [toId(username)], (row)=>{
		res = row;
	}, ()=>{
		if(!res && createNewEntry){
			runSql(INSERT_USER_SQL, [toId(username), removeRank(username)], null, ()=>{
				runSql(INSERT_ALT_SQL, [toId(username), toId(username)], null, (res)=>{
					info(JSON.stringify(res));
					// TODO can this be done without the extra call? using rows as array?
					getId(username, createNewEntry, onEnd, onError);
				}, onError);
			}, onError);
		}else{
			onEnd(res);
		}
	}, onError);
	*/
}
exports.getUser = getUser

// the second arg of callback is an array with two elements
let getMains = function(username1, username2, createNewEntry, callback){
	getUser(username1, createNewEntry, (err, user1)=>{
		if(err){
			callback(err);
			return;
		}
		getUser(username2, createNewEntry, (err, user2)=>{
			callback(err, [user1, user2]);
		});
	});
}
exports.getMains = getMains

// TODO change to not sqlconfig
let getPoints = function(id, leaderboards, callback){
	let queryConfig = {
		text: GET_POINTS_SQL,
		values: [id, leaderboards],
		rowMode: 'array'
	};
	runSqlConfig(queryConfig, callback);
};
exports.getPoints = getPoints;

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
