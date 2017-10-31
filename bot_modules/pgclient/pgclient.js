let chat = null;
let auth = null;
let rooms = null;
let pg = require("pg");
let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};

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

let pgReconnect = function(message){
	try{
		if(self.data && self.data.client){
			self.data.client.end();
		}
	}catch(e){
		error(e.message);
	}

	try{
		self.data.client = new pg.Client(conInfo);
		self.data.client.connect((err)=>{
			if(err){
				error(err);
				if(message){
					chat.js.reply(message, "Unable to connect to database.");
				}
			}else{
				ok("Client is connected");
				chat.js.reply(message, "The client is now connected to the database.");
				self.data.connected = true;
			}
		});
		self.data.client.on("error",(e)=>{
			error(e.message);
		});
		self.data.client.on("end",()=>{
			self.data.connected = false;
			error("Client connection ended");
		});
	}catch(e){
		error(e.message);
		if(message){
			chat.js.reply(message, "Unable to connect to database.");
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
	if(!self.data.connected){
		onError("The bot is not connected to the database.");
	}
	try{
		let query = self.data.client.query(statement,args);
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

exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){
		try{
			if(self.data && self.data.client){
					self.data.client.end();
			}
		}catch(e){
			error(e.message);
		}

		self.data = {};

		try{
			self.data.client = new pg.Client(conInfo);
			self.data.client.connect((err)=>{
				if(err){
					error(err);
				}else{
					ok("Client is connected");
					self.data.connected = true;
				}
			});
			self.data.client.on("error",(e)=>{
				error(e.message);
			});
			self.data.client.on("end",()=>{
				self.data.connected = false;
				error("Client connection ended");
			});
		}catch(e){
			error(e.message);
		}
	}
	self.chathooks = {
		chathook: function(m){
			if(m && !m.isInit){
				let text = m.message;
				if(text[0]==="~"){
					let command = text.split(" ")[0].trim().toLowerCase().substr(1);
					let argText = text.substring(command.length+2, text.length);
					let chatArgs = argText === "" ? [] : argText.split(",");
					for(let i = 0;i<chatArgs.length;i++){
						chatArgs[i] = chatArgs[i].trim();
					}
					if(commands[command]&&auth&&auth.js&&chat&&chat.js&&rooms&&rooms.js){
						let rank = auth.js.getEffectiveRoomRank(m, "trivia");
						let commandToRun = commands[command];
						if(typeof commandToRun === "string"){
							commandToRun = commands[commandToRun];
						}
						commandToRun(m, chatArgs, rank);
					}
				}
			}
		}
	};
};
exports.onUnload = function(){

};

exports.refreshDependencies = function(){
	chat = getModuleForDependency("chat", "pgclient");
	auth = getModuleForDependency("auth", "pgclient");
	rooms = getModuleForDependency("rooms", "pgclient");
};

let commands = {
  reconnect: function(message, args, rank){
    if(auth.js.rankgeq(rank,"@")){
      pgReconnect(message);
    }
  }
};
