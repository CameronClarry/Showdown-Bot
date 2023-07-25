const {Pool, Client} = require('pg');

const GET_USER_SQL = "SELECT users.id, users.username, users.display_name FROM alts INNER JOIN users ON alts.main_id = users.id WHERE alts.username = $1 FETCH FIRST 1 ROWS ONLY;";
const INSERT_USER_SQL = "INSERT INTO users (username, display_name) VALUES ($1, $2);";
const INSERT_ALT_SQL = "INSERT INTO alts (username, main_id) VALUES ($1::VARCHAR, (SELECT id FROM users WHERE username = $1::VARCHAR FETCH FIRST 1 ROWS ONLY));";

const GET_SPECIFIC_POINTS_SQL = "SELECT ttp.points, ttl.id FROM tt_leaderboards ttl LEFT JOIN tt_points ttp ON ttp.leaderboard = ttl.id AND ttp.id = $1 WHERE ttl.id = ANY($2);";
const GET_ALL_POINTS_SQL = "SELECT ttp.points, ttl.id FROM tt_leaderboards ttl LEFT JOIN tt_points ttp ON ttp.leaderboard = ttl.id AND ttp.id = $1;";
const GET_ENABLED_POINTS_SQL = "SELECT ttp.points, ttl.id FROM tt_leaderboards ttl LEFT JOIN tt_points ttp ON ttp.leaderboard = ttl.id AND ttp.id = $1 WHERE ttl.enabled = TRUE;";

const INSERT_LB_ENTRY_SQL = "INSERT INTO tt_points VALUES ($1, $2, $3);";
const UPDATE_LB_ENTRY_SQL = "UPDATE tt_points SET points = $3 WHERE id = $1 AND leaderboard = $2;";

const conInfo = {
	user: bot.config.dbuser.value,
	password: bot.config.dbpassword.value,
	database: bot.config.dbname.value,
	host: bot.config.dbhost.value,
	port: bot.config.dbport.value,
	max: 1
};

let commands = {
	reconnect: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, '@')){
			this.pgReconnect(room, user, rank);
		}
	}
};

class PGClient extends BaseModule{
	constructor(){
		super();
		this.room = PGClient.room;
		this.config = {};
		this.commands = commands;
		this.dependencies = ['achievements'];
	}

	onLoad(){
		this.pgReconnect(logIfError);
	}

	onUnload(){
		if(this.pool) this.pool.end();
	}

	recover(oldModule){
		this.pool = oldModule.pool;
		this.connected = oldModule.connected;
	}

	pgReconnect(callback){
		try{
			if(this.pool){
				this.pool.end();
			}
			this.connected = false;
		}catch(e){
			error(e.message);
		}

		try{
			this.pool = new Pool(conInfo);
			//this.pool.connect((err)=>{
				//if(err){
					//callback(err);
					//return;
				//}
				//ok("Client is connected");
				//this.connected = true;
				//callback();
			//});
			this.pool.on('error',(e)=>{
				error(e.message);
			});
			this.pool.on('end',()=>{
				this.connected = false;
				error("Client connection ended");
			});
			//this.pool.on('connect',()=>{
				//ok("Client is connected");
			//});
		}catch(e){
			callback(e);
		}
	};

	checkout(callback){
		this.pool.connect(callback);
	}

	runSql(statement, args, callback, client){
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
				this.pool.query(queryConfig, callback);
			}
		}catch(err){
			callback(err);
		}
	};

	runSqlAsArray(statement, args, callback, client){
		if(!callback){
			callback = (err) => {if (err) error(err);};
		}
		if(!data.connected){
			callback("The bot is not connected to the database.");
			return;
		}
		try{
			let queryConfig = {
				text: statement,
				values: args,
				rowMode: 'array'
			};
			if(client){
				client.query(queryConfig, callback);
			}else{
				this.pool.query(queryConfig, callback);
			}
		}catch(err){
			callback(err);
		}
	};

	//Takes a username, returns their entry in the users table if it exists. Can also add missing users to the database.
	getUser(username, createNewEntry, callback, client){
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
					this.getUser(username, createNewEntry, callback, client);
				};
				this.runSql(INSERT_USER_SQL, [toId(username), removeRank(username)], (err, res)=>{
					if(err){
						callback(err);
						return;
					}
					this.runSql(INSERT_ALT_SQL, [toId(username)], newEntryCallback, client);
				}, client);
			}else{
				callback(null, res.rows[0]);
			}
		}
		this.runSql(GET_USER_SQL, [toId(username)], newCallback, client);
	}

	getMains(username1, username2, createNewEntry, callback, client){
		this.getUser(username1, createNewEntry, (err, user1)=>{
			if(err){
				callback(err);
				return;
			}
			this.getUser(username2, createNewEntry, (err, user2)=>{
				callback(err, [user1, user2]);
			}, client);
		}, client);
	}

	getPoints(id, leaderboards, callback, client){
		if(leaderboards === 'all'){
			this.runSql(GET_ALL_POINTS_SQL, [id], callback, client);
		}else if(leaderboards === 'enabled'){
			this.runSql(GET_ENABLED_POINTS_SQL, [id], callback, client);
		}else if(leaderboards.length){
			this.runSql(GET_SPECIFIC_POINTS_SQL, [id, leaderboards], callback, client);
		}else if(leaderboards.length === 0){
			callback("No leaderboards requested");
		}else{
			callback("Invalid format for leaderboards given.");
		}
	}

	updatePointsByDbId(dbId, name, updateFunc, leaderboards, callback, client){
		this.getPoints(dbId, leaderboards, (err, res)=>{
			if(err){
				callback(err);
				return;
			}else if(res.rows.length == 0){
				callback("No valid leaderboard specified");
				return;
			}
			let pendingCalls = res.rows.length;
			let totalError = null;
			let updatedPoints = {};

			let sharedCallback = (err, boardId, points)=>{
				totalError = totalError || err;
				updatedPoints[boardId] = points;
				pendingCalls--;
				if(err) error(err);
				if(pendingCalls === 0) callback(totalError, name, res.rows, updatedPoints);
			};

			for(let i=0;i<res.rows.length;i++){
				let curPoints = res.rows[i].points || 0;
				let leaderboardId = res.rows[i].id;
				let newPoints = updateFunc(curPoints, leaderboardId);
				let uniqueCallback = (err, res2)=>{
					if(res2.rowCount){
						sharedCallback(err, leaderboardId, newPoints);
					}else{
						sharedCallback(err, leaderboardId, null);
					}
				}
				if(res.rows[i].points !== null){
					this.runSql(UPDATE_LB_ENTRY_SQL, [dbId, leaderboardId, newPoints], uniqueCallback, client);
				}else{
					this.runSql(INSERT_LB_ENTRY_SQL, [dbId, leaderboardId, newPoints], uniqueCallback, client);
				}
				this.achievements.achievementsOnScoreUpdate(name, leaderboardId, curPoints, updateFunc(curPoints, leaderboardId));
			}
		}, client);
	}

	// TODO move the checkout to the dbId function. Only checkout if no client is given
	updatePointsByPsId(psId, name, updateFunc, leaderboards, callback, client){
		this.checkout((err, client, done)=>{
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

			this.getUser(name, true, (err, user)=>{
				if(err){
					done()
					callback(err);
					return;
				}

				this.updatePointsByDbId(user.id, name, updateFunc, leaderboards, newCallback, client);
			}, client);
		})
	}
}

exports.Module = PGClient;
