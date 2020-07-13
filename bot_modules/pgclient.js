const {Pool} = require('pg');
const pool = new Pool();
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let data = {};
let config = defaultConfigs;
let achievements = null;

const GOVERNING_ROOM = "trivia"
exports.GOVERNING_ROOM = GOVERNING_ROOM

const GET_USER_SQL = "SELECT users.id, users.username, users.display_name FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 FETCH FIRST 1 ROWS ONLY;";
const INSERT_USER_SQL = "INSERT INTO users (username, display_name) VALUES ($1, $2);";
const INSERT_ALT_SQL = "INSERT INTO alts (username, main_id) VALUES ($1::VARCHAR, (SELECT id FROM users WHERE username = $1::VARCHAR FETCH FIRST 1 ROWS ONLY));";

const GET_SPECIFIC_POINTS_SQL = "SELECT ttp.points, ttl.id FROM tt_leaderboards ttl LEFT JOIN tt_points ttp ON ttp.leaderboard = ttl.id AND ttp.id = $1 WHERE ttl.id = ANY($2);";
const GET_ALL_POINTS_SQL = "SELECT ttp.points, ttl.id FROM tt_leaderboards ttl LEFT JOIN tt_points ttp ON ttp.leaderboard = ttl.id AND ttp.id = $1;";
const GET_ENABLED_POINTS_SQL = "SELECT ttp.points, ttl.id FROM tt_leaderboards ttl LEFT JOIN tt_points ttp ON ttp.leaderboard = ttl.id AND ttp.id = $1 WHERE ttl.enabled = TRUE;";

const INSERT_LB_ENTRY_SQL = "INSERT INTO tt_points VALUES ($1, $2, $3);";
const UPDATE_LB_ENTRY_SQL = "UPDATE tt_points SET points = $3 WHERE id = $1 AND leaderboard = $2;";

const conInfo = {
	user: mainConfig.dbuser,
	password: mainConfig.dbpassword,
	database: mainConfig.dbname,
	host: mainConfig.dbhost,
	port: mainConfig.dbport,
	max: 1
};

//TODO this should no be dealing with rooms, users, and ranks. simply a callback.
let pgReconnect = function(callback){
	try{
		if(data && data.pool){
			data.pool.end();
		}
		data.connected = false;
	}catch(e){
		error(e.message);
	}

	try{
		data.pool = new Pool(conInfo);
		//data.pool.connect((err)=>{
			//if(err){
				//callback(err);
				//return;
			//}
			//ok("Client is connected");
			//data.connected = true;
			//callback();
		//});
		data.pool.on('error',(e)=>{
			error(e.message);
		});
		data.pool.on('end',()=>{
			data.connected = false;
			error("Client connection ended");
		});
		//data.pool.on('connect',()=>{
			//ok("Client is connected");
		//});
	}catch(e){
		callback(e);
	}
};

//This runs a postgres query, handles errors, etc.
let runSql = function(statement, args, callback, client){
	info(statement);
	if(!callback){
		callback = (err) => {if (err) error(err);};
	}
	//if(!data.connected){
		//callback("The bot is not connected to the database.");
	//}
	try{
		let queryConfig = {
			text: statement,
			values: args
		};
		if(client){
			client.query(queryConfig, callback);
		}else{
			data.pool.query(queryConfig, callback);
		}
	}catch(err){
		callback(err);
	}
};
exports.runSql = runSql;



let runSqlAsArray = function(statement, args, callback, client){
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

// callback(err, client, done)
let checkout = function(callback){
	data.pool.connect(callback);
};
exports.checkout = checkout;

//Takes a username, returns their entry in the users table if it exists. Can also add missing users to the database.
// TODO find all references to this, and make the callback something more descriptive than 'res'
let getUser = function(username, createNewEntry, callback, client){
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
				getUser(username, createNewEntry, callback, client);
			};
			runSql(INSERT_USER_SQL, [toId(username), removeRank(username)], (err, res)=>{
				if(err){
					callback(err);
					return;
				}
				runSqlAsArray(INSERT_ALT_SQL, [toId(username)], newEntryCallback, client);
			}, client);
		}else{
			callback(null, res.rows[0]);
		}
	}
	runSql(GET_USER_SQL, [toId(username)], newCallback, client);
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
let getMains = function(username1, username2, createNewEntry, callback, client){
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

let getPoints = function(id, leaderboards, callback, client){
	info(leaderboards)
	if(leaderboards === 'all'){
		runSql(GET_ALL_POINTS_SQL, [id], callback, client);
	}else if(leaderboards === 'enabled'){
		runSql(GET_ENABLED_POINTS_SQL, [id], callback, client);
	}else if(leaderboards.length){
		runSql(GET_SPECIFIC_POINTS_SQL, [id, leaderboards], callback, client);
	}else{
		callback("Invalid format for leaderboards given.");
	}
};
exports.getPoints = getPoints;

let updatePointsByDbId = function(dbId, name, updateFunc, leaderboards, callback, client){
	getPoints(dbId, leaderboards, (err, res)=>{
		if(err){
			callback(err);
			return;
		}
		let pendingCalls = res.rows.length;
		let totalError = null;

		let sharedCallback = (err, res2)=>{
			totalError = totalError || err;
			pendingCalls--;
			if(err) error(err);
			// TODO decide whether to return failed updates
			if(pendingCalls === 0) callback(totalError, name, res.rows.length, []);
		};

		for(let i=0;i<res.rows.length;i++){
			info(JSON.stringify(res.rows[i]));
			let curPoints = res.rows[i].points || 0;
			let leaderboardId = res.rows[i].id;
			if(res.rows[i].points !== null){
				info('updating');
				runSql(UPDATE_LB_ENTRY_SQL, [dbId, leaderboardId, updateFunc(curPoints, leaderboardId)], sharedCallback, client);
			}else{
				info('inserting');
				runSql(INSERT_LB_ENTRY_SQL, [dbId, leaderboardId, updateFunc(curPoints, leaderboardId)], sharedCallback, client);
			}
			achievements.achievementsOnScoreUpdate(name, leaderboardId, curPoints, updateFunc(curPoints, leaderboardId));
		}
	}, client);
}
exports.updatePointsByDbId = updatePointsByDbId;

let updatePointsByPsId = function(psId, name, updateFunc, leaderboards, callback, client){
	checkout((err, client, done)=>{
		if(err){
			client.end();
			done();
			callback(err);
			return;
		}

		let newCallback = (err, username, affected, failed)=>{
			done();
			callback(err, username, affected, failed);
		};

		getUser(name, true, (err, res)=>{
			if(err){
				done()
				callback(err);
				return;
			}

			updatePointsByDbId(res.id, name, updateFunc, leaderboards, newCallback, client);
		}, client);
	});
}
exports.updatePointsByPsId = updatePointsByPsId;

exports.onLoad = function(module, loadData, oldData){
	self = module;
	refreshDependencies();
	if(oldData) data = oldData;
	if(loadData){
		data = {};
		pgReconnect(logIfError);
	}
};
exports.onUnload = function(){
	if(data && data.pool){
		pool.end();
	}
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
	achievements = getModuleForDependency("achievements", "pgclient");
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
