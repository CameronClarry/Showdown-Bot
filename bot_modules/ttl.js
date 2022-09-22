let fs = require("fs");
let spawn = require('child_process').spawn;

const INSERT_LB_SQL = "INSERT INTO tt_leaderboards VALUES($1, $2, CURRENT_TIMESTAMP, $3, true);";
const INSERT_ALIAS_SQL = "INSERT INTO leaderboard_aliases VALUES($1, $1)";
const DELETE_LB_SQL = "DELETE FROM tt_leaderboards WHERE id = $1;";
const GET_LB_SQL = "SELECT lb.id, lb.display_name, lb.created_on, users.display_name AS created_by, lb.enabled FROM leaderboard_aliases AS aliases INNER JOIN tt_leaderboards AS lb ON aliases.leaderboard_id = lb.id LEFT OUTER JOIN users ON lb.created_by = users.id WHERE aliases.alias_id = $1;";
const GET_ALL_LB_SQL = "SELECT * FROM tt_leaderboards;";
const GET_ENABLED_LB_SQL = "SELECT * FROM tt_leaderboards WHERE enabled = TRUE;";
const RESET_MAIN_LB_SQL = "UPDATE tt_leaderboards SET created_on = CURRENT_TIMESTAMP, created_by = $1 WHERE id = 'main';";
const DELETE_USER_ENTRIES_SQL = "DELETE FROM tt_points WHERE id = $1;";
const UPDATE_LB_SQL = "UPDATE tt_leaderboards SET enabled = $2 WHERE id = $1;";
const ENABLE_ALL_LB_SQL = "UPDATE tt_leaderboards SET enabled = true;";
const DISABLE_ALL_LB_SQL = "UPDATE tt_leaderboards SET enabled = false;";

const DELETE_LB_ENTRIES_SQL = "DELETE FROM tt_points WHERE leaderboard = $1;";
const GET_ALL_LB_ENTRIES_SQL = "SELECT lb.points, users.display_name FROM tt_points AS lb INNER JOIN leaderboard_aliases AS aliases ON lb.leaderboard = aliases.leaderboard_id LEFT OUTER JOIN users ON lb.id = users.id WHERE aliases.alias_id = $1 AND lb.points > 0 ORDER BY lb.points DESC;";
const LIST_LB_ENTRIES_SQL = "SELECT lb.points, users.display_name, tt_leaderboards.display_name AS lb_name FROM tt_points AS lb INNER JOIN leaderboard_aliases AS aliases ON lb.leaderboard = aliases.leaderboard_id LEFT OUTER JOIN users ON lb.id = users.id LEFT OUTER JOIN tt_leaderboards ON lb.leaderboard = tt_leaderboards.id WHERE aliases.alias_id = $1 AND lb.points > 0 ORDER BY lb.points DESC FETCH FIRST _NUMBER_ ROWS ONLY;";
const GET_STATS = "SELECT AVG(points)::FLOAT avg_points, STDDEV_POP(points)::FLOAT std_points, COUNT(*)::INTEGER num_players FROM tt_points WHERE points > 0 AND leaderboard = $1;";

let commands = {
	ttl: "ttleaderboard",
	ttleaderboard: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0){
			let command = args[0].toLowerCase();
			if(ttleaderboardCommands[command]){
				ttleaderboardCommands[command].call(this, message, args, user, rank, room, commandRank, commandRoom);
			}
		}
	},
	event: function(message, args, user, rank, room, commandRank, commandRoom){
		if(args.length>0){
			let command = args[0].toLowerCase();
			if(ttleaderboardEventCommands[command]){
				ttleaderboardEventCommands[command].call(this, message, args, user, rank, room, commandRank, commandRoom);
			}
		}
	}
};

let ttleaderboardCommands = {
	list: function(message, args, user, rank, room, commandRank, commandRoom){
		let lb = args[2] || "main";
		let number = /^[\d]+$/.test(args[1]) ? parseInt(args[1], 10) : 5;
		let rows = [];
		this.listLeaderboardEntries([number, lb], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, `Error: ${err}`);
				return;
			}

			let rows = res.rows;
			if(!rows.length){
				room.broadcast(user, `There are no players on the ${lb} leaderboard.`, rank, true);
			}else{
				if(args[3] &&  AuthManager.rankgeq(commandRank, "%")){
					sayScores(rows, lb, room);
				}else{
					room.broadcast(user, `The top ${rows.length} score${rows.length === 1 ? "" : "s"} on the ${rows[0].lb_name} leaderboard ${rows.length === 1 ? "is" : "are"}: ${rows.map((row)=>{return `__${row.display_name || row.id1}__: ${row.points}`}).join(", ")}.`, rank, true);
				}
			}
		});
	},
	listall: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, "#")) return;
		let lb = toId(args[1]) || "main";
		this.getAllLeaderboardEntries(lb, (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, `Error: ${err}`);
				return;
			}

			let rows = res.rows;
			if(!rows.length){
				user.send("There are no players on the " + lb + " leaderboard.");
			}else{
				let text = `Listed here all players with a score of at least 1 on the ${lb} leaderboard.\n`;
				text = text + `\n${rows.map((row)=>{return `${row.display_name || row.id1}: ${row.points}`}).join("\n")}`;
				uploadText(text, (err, address)=>{
					if(err){
						error(err);
						user.send(`Error: ${err}`);
						return;
					}
					user.send(`Here is the full leaderboard: ${address}`);
				});
			}
		});
	},
	check: function(message, args, user, rank, room, commandRank, commandRoom){
		let username = args[1] || user.name;
		let boardId = toId(args[2]) || "main";
		this.pgclient.runSql(GET_LB_SQL, [boardId], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, `Error: ${err}`);
				return;
			}

			if(!res.rowCount){
				room.broadcast(user, "The leaderboard you entered does not exist.", rank, true);
			}else{
				let boardName = res.rows[0].display_name;
				boardId = res.rows[0].id;
				this.pgclient.getUser(username, false, (err, dbUser)=>{
					if(err){
						error(err);
						room.broadcast(user, `Error: ${err}`);
						return;
					}

					if(!dbUser){
						room.broadcast(user, `${username} does not have a score on the ${boardName} leaderboard.`, rank, true);
					}else{
						this.pgclient.getPoints(dbUser.id, [boardId], (err, res)=>{
							if(err){
								error(err);
								room.broadcast(user, `Error: ${err}`);
								return;
							}

							if(!res.rows.length || res.rows[0].points === null){
								room.broadcast(user, `${dbUser.display_name} does not have a score on the ${boardName} leaderboard.`, rank, true);
							}else{
								room.broadcast(user, `${dbUser.display_name}'s score on the ${boardName} leaderboard is ${res.rows[0].points}.`, rank, true);
							}
						});
					}
				});
			}
		});
	},
	//Number of people, your place, your score, points to next place
	summary: function(message, args, user, rank, room, commandRank, commandRoom){
		let lbId = toId(args[1]) || "main";
		let userId = (AuthManager.rankgeq(commandRank, "%") && toId(args[2])) || user.id;
		this.pgclient.runSql(GET_LB_SQL, [lbId], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, `Error: ${err}`);
				return;
			}
			
			if(!res.rowCount){
				room.broadcast(user, "The leaderboard you entered does not exist.", rank);
			}else{
				let lbName = res.rows[0].display_name;
				lbId = res.rows[0].id;
				this.pgclient.getUser(userId, false, (err, dbUser)=>{
					if(err){
						error(err);
						room.broadcast(user, `Error: ${err}`);
						return;
					}

					if(!dbUser){
						room.broadcast(user, `You do not have a score on the ${lbName} leaderboard.`, rank);
					}else{
						this.pgclient.getPoints(dbUser.id, [lbId], (err, res)=>{
							if(err){
								error(err);
								room.broadcast(user, `Error: ${err}`);
								return;
							}

							if(!res.rows.length || res.rows[0].points === null){
								room.broadcast(user, `You do not have a score on the ${lbName} leaderboard.`, rank);
							}else{
								let score = res.rows[0].points;
								this.getAllLeaderboardEntries(lbId, (err, res3)=>{
									if(err){
										error(err);
										room.broadcast(user, `Error: ${err}`);
										return;
									}

									let entries = res3.rows;
									if(entries.length === 0){
										room.broadcast(user, "There doesn't seem to be anyone on the leaderboard. Maybe something went wrong.", rank);
									}else if(entries.length === 1){
										room.broadcast(user, `You are the only person on the leaderboard (and your score is ${score}).`, rank);
									}else if(entries[0].points === score){
										let nextPlayer = idsMatch(entries[0].display_name, dbUser.display_name) ? entries[1] : entries[0];
										let response = `You are first on the leaderboard with ${score} points.`
										response += ` Second place is __${nextPlayer.display_name}__ with ${entries[1].points} points.`;
										room.broadcast(user, response, rank);
									}else{
										let higherEntries = entries.filter(item=>{return item.points > score});
										let response = `First place is __${entries[0].display_name}__ with ${entries[0].points} points.`;
										response += ` Your rank is ${higherEntries.length+1} with ${score} points.`;
										response += ` The next player above you is __${higherEntries[higherEntries.length - 1].display_name}__ with ${higherEntries[higherEntries.length - 1].points} points.`;
										room.broadcast(user, response, rank);
									}
								});
							}
						});
					}
				});
			}
		});
	},
	// TODO this does not need to get all leaderboards
	stats: function(message, args, user, rank, room, commandRank, commandRoom){
		let lbId = toId(args[1]) || 'main';
		this.pgclient.runSql(GET_ALL_LB_SQL, [], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, `Error: ${err}`);
				return;
			}

			let lbEntry = res.rows.filter((row)=>{return row.id === lbId;})[0];
			if(!lbEntry){
				room.broadcast(user, "That leaderboard doesn't exist.", rank);
			}else{
				info(JSON.stringify(lbEntry));
				let lbName = lbEntry.display_name;
				this.pgclient.runSql(GET_STATS, [lbId], (err, res2)=>{
					if(err){
						error(err);
						room.broadcast(user, `Error: ${err}`);
						return;
					}

					if(res2.rowCount === 0 || res2.rows[0].num_players === 0){
						room.broadcast(user, "There are no players on that leaderboard.", rank);
					}else{
						let num = res2.rows[0].num_players;
						let std = Math.round(res2.rows[0].std_points*100)/100;
						let avg = Math.round(res2.rows[0].avg_points*10)/10;
						room.broadcast(user, `There are ${num} players on the ${lbName} leaderboard. The average score is ${avg} and the standard deviation is ${std}.`, rank);
					}
				});
			}
		});
	},
	set: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.editScoreRank.value)){
			room.broadcast(user, "Your rank is not high enough to change someone's score.", rank);
		}else if(args.length<=2 || !toId(args[1])){
			room.broadcast(user, "You must specify the user's name, the amount of points to set them to, and optionally the leaderboard.", rank);
		}else if(!/^[\d]+$/.test(args[2])){
			room.broadcast(user, "Invalid number format for the number of points.", rank);
		}else{
			let username = args[1];
			let points = parseInt(args[2], 10);
			let boardId = toId(args[3]) || "main"
			this.pgclient.runSql(GET_LB_SQL, [boardId], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}

				if(!res.rowCount){
					room.broadcast(user, "That leaderboard doesn't exist.", rank);
				}else{
					let boardName = res.rows[0].display_name;
					boardId = res.rows[0].id;
					this.pgclient.updatePointsByPsId(toId(username), username , (oldPoints)=>{
						return points;
					}, [boardId], (err, name, oldPoints, newPoints)=>{
						if(err){
							error(err);
							room.broadcast(user, `Error: ${err}`);
							return;
						}

						if(oldPoints[0].points === null){
							room.broadcast(user, `Created a new ${boardName} leaderboard entry for ${username} and set their score to ${newPoints[boardId]}.`, rank);
						}else{
							room.broadcast(user, `Updated the score for ${name}. Their ${boardName} leaderboard score changed from ${oldPoints[0].points} to ${newPoints[boardId]}.`, rank);
						}
					});
				}
			});
		}
	},
	add: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.editScoreRank.value)){
			room.broadcast(user, "Your rank is not high enough to change someone's score.", rank);
		}else if(args.length<=2 || !toId(args[1])){
			room.broadcast(user, "You must specify the user's name, and the number of points to add.", rank);
		}else if(!/^-?[\d]+$/.test(args[2])){
			room.broadcast(user, "Invalid number format for the number of points.", rank);
		}else{
			let username = args[1];
			let points = parseInt(args[2], 10);
			this.pgclient.updatePointsByPsId(toId(username), username, (oldPoints)=>{
				return Math.max(oldPoints + points, 0);
			}, 'enabled', (err, username, oldPoints, newPoints)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}

				let response = `Updated ${oldPoints.length} scores for ${username}.`;
				room.broadcast(user, response, rank);
			});
		}
	},
	addto: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.editScoreRank.value)){
			room.broadcast(user, "Your rank is not high enough to change someone's score.", rank);
		}else if(args.length<4 || !toId(args[1]) || !toId(args[3])){
			room.broadcast(user, "You must specify the user's name, the number of points to add, and the leaderboard.", rank);
		}else if(!/^-?[\d]+$/.test(args[2])){
			room.broadcast(user, "Invalid number format for the number of points.", rank);
		}else{
			let username = args[1];
			let points = parseInt(args[2], 10);
			let boardId = toId(args[3])
			this.pgclient.runSql(GET_LB_SQL, [boardId], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}
				
				if(!res.rowCount){
					room.broadcast(user, "That leaderboard doesn't exist.", rank);
				}else{
					let boardName = res.rows[0].display_name;
					boardId = res.rows[0].id;
					this.pgclient.updatePointsByPsId(toId(username), username , (oldPoints)=>{
						return oldPoints + points;
					}, [boardId], (err, name, oldPoints, newPoints)=>{
						if(err){
							error(err);
							room.broadcast(user, `Error: ${err}`);
							return;
						}

						if(oldPoints[0].points === null){
							room.broadcast(user, `Created a new ${boardName} leaderboard entry for ${username} and set their score to ${newPoints[boardId]}.`, rank);
						}else{
							room.broadcast(user, `Updated the score for ${name}. Their ${boardName} leaderboard score changed from ${oldPoints[0].points} to ${newPoints[boardId]}.`, rank);
						}
					});
				}
			});
		}
	},
	remove: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!toId(args[1])){
			room.broadcast(user, "You must specify a user.", rank);
		}else if(!AuthManager.rankgeq(commandRank, this.config.editScoreRank.value)){
			room.broadcast(user, "Your rank is not high enough to remove someone's leaderboard entries.", rank);
		}else{
			this.pgclient.getUser(args[1], false, (err, dbUser)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}

				if(!dbUser){
					room.broadcast(user, `${args[1]} does not have any leaderboard entries.`, rank);
				}else{
					this.removeAllLeaderboardEntries(dbUser.id, (err, res)=>{
						if(err){
							error(err);
							room.broadcast(user, `Error: ${err}`);
							return;
						}

						room.broadcast(user, `Removed ${res.rowCount} leaderboard entries for ${dbUser.display_name}.`, rank);
					});
				}
			});
		}
	},
	reset: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.resetLeaderboardRank.value)){
			room.broadcast(user, "Your rank is not high enough to reset the leaderboard.", rank);
		}else{
			if(idsMatch(user.id, this.askToReset)){
				try{
					let child = spawn("pg_dump", [bot.config.dbname.value]);
					let filename = `backups/${new Date().toISOString()}.dump`;
					let backupStream = fs.createWriteStream(filename, {flags: 'a'});
					child.stdout.pipe(backupStream);
					child.on('error', (err)=>{
						error("There was an error with the subprocess.");
						room.broadcast(user, "There was an error with the subprocess responsible for creating the database dump.", rank);
					});
					child.on("exit", (code, signal)=>{
						// Now that the database has been written, it's okay to reset
						this.getAllLeaderboardEntries("main", (err, res)=>{
							if(err){
								error(err);
								room.broadcast(user, `Error: ${err}`);
								return;
							}

							this.pgclient.getUser(user.id, true, (err, dbUser)=>{
								if(err){
									error(err);
									room.broadcast(user, `Error: ${err}`);
									return;
								}

								this.pgclient.runSql(DELETE_LB_ENTRIES_SQL, ["main"], (err, res2)=>{
									if(err){
										error(err);
										room.broadcast(user, `Error: ${err}`);
										return;
									}

									this.pgclient.runSql(RESET_MAIN_LB_SQL, [dbUser.id], (err, res3)=>{
										if(err){
											error(err);
											room.broadcast(user, `Error: ${err}`);
											return;
										}

										room.broadcast(user, `Successfully deleted ${res2.rowCount} score(s) from the main leaderboard.`, rank);
										this.askToReset = "";
										if(this.achievements) this.achievements.achievementsOnReset("main", res.rows);
										if(this.config.scoreWebhook && this.config.scoreWebhook.value) sendWebhook(this.config.scoreWebhook.value, `The top 10 scores on the main leaderboard are: ${res.rows.slice(0,10).map((row)=>{return `__${row.display_name || row.id1}__: ${row.points}`}).join(", ")}.`);
									});
								});
							});
						});
					});
				}catch(e){
					error(e.message);
					room.broadcast(user, "There was an error creating the subprocess responsible for creating the database dump.", rank);
				}
			}else{
				this.askToReset = user.id;
				room.broadcast(user, "Are you sure you want to reset the leaderboard? (Enter the reset command again to confirm)", rank);
			}
		}
	}
};

let ttleaderboardEventCommands = {
	list: function(message, args, user, rank, room, commandRank, commandRoom){
		this.pgclient.runSql(GET_ALL_LB_SQL, [], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, `Error: ${err}`);
				return;
			}

			if(!res.rowCount){
				room.broadcast(user, "There are no leaderboards right now.", rank);
			}else{
				let leaderboards = res.rows.map((row)=>{return row.display_name;});
				room.broadcast(user, `These are the current leaderboards: ${leaderboards.join(", ")}`, rank);
			}
		});
	},
	add: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.manageEventRank.value)){
			room.broadcast(user, "Your rank is not high enough to create a leaderboard.", rank);
		}else if(args.length<2 || !toId(args[1])){
			room.broadcast(user, "You must specify the name for the leaderboard.", rank);
		}else if(args[1].length > 20){
			room.broadcast(user, "That name is too long.", rank);
		}else{
			let boardName = args[1];
			this.pgclient.runSql(GET_LB_SQL, [toId(boardName)], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}

				if(res.rowCount){
					room.broadcast(user, "A leaderboard already exists with the same name.", rank);
				}else{
					this.pgclient.getUser(user.id, true, (err, dbUser)=>{
						if(err){
							error(err);
							room.broadcast(user, `Error: ${err}`);
							return;
						}

						this.pgclient.runSql(INSERT_LB_SQL, [toId(boardName), boardName, dbUser.id], (err, res2)=>{
							if(err){
								error(err);
								room.broadcast(user, `Error: ${err}`);
								return;
							}

							this.pgclient.runSql(INSERT_ALIAS_SQL, [toId(boardName)], (err, res3)=>{
								if(err){
									error(err);
									room.broadcast(user, `Error: ${err}`);
									return;
								}

								room.broadcast(user, "Successfully created a new leaderboard.", rank);
							});
						});
					});
				}
			});
		}
	},
	remove: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.manageEventRank.value)){
			room.broadcast(user, "Your rank is not high enough to remove a leaderboard.", rank);
		}else if(args.length<2 || !toId(args[1])){
			room.broadcast(user, "You must specify the name for the leaderboard.", rank);
		}else if(toId(args[1]) === "main"){
			room.broadcast(user, "You cannot remove that leaderboard.", rank);
		}else{
			let id = toId(args[1]);
			this.pgclient.runSql(GET_LB_SQL, [id], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}

				if(!res.rowCount){
					room.broadcast(user, "There is no leaderboard with that name.", rank);
				}else{
					id = res.rows[0].id;
					this.pgclient.runSql(DELETE_LB_ENTRIES_SQL, [id],(err, res2)=>{
						if(err){
							error(err);
							room.broadcast(user, `Error: ${err}`);
							return;
						}

						this.pgclient.runSql(DELETE_LB_SQL, [id], (err, res3)=>{
							if(err){
								error(err);
								room.broadcast(user, `Error: ${err}`);
								return;
							}

							room.broadcast(user, `Successfully removed the leaderboard and deleted ${res2.rowCount} score(s).`, rank);
						});
					});
				}
			});
		}
	},
	info: function(message, args, user, rank, room, commandRank, commandRoom){
		let id = args[1] || "main";
		this.pgclient.runSql(GET_LB_SQL, [id], (err, res)=>{
			if(err){
				error(err);
				room.broadcast(user, `Error: ${err}`);
				return;
			}
			
			let lbEntry = res.rows[0];
			if(!res.rowCount){
				room.broadcast(user, "The leaderboard you specified doesn't exist.", rank);
			}else if(lbEntry.id !== "main"){
				room.broadcast(user, `Leaderboard name: ${lbEntry.display_name}, created on: ${lbEntry.created_on.toUTCString()}, created by: ${lbEntry.created_by}, enabled: ${lbEntry.enabled}`, rank);
			}else{
				room.broadcast(user, `Leaderboard name: ${lbEntry.display_name}, last reset: ${lbEntry.created_on.toUTCString()}, reset by: ${lbEntry.created_by}, enabled: ${lbEntry.enabled}`, rank);
			}
		});
	},
	enable: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.manageEventRank.value)){
			room.broadcast(user, "Your rank is not high enough to enable a leaderboard.", rank);
		}else if(args.length<2){
			room.broadcast(user, "You must specify the name for the leaderboard.", rank);
		}else{
			let id = toId(args[1]);
			this.pgclient.runSql(GET_LB_SQL, [id], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}
			
				let lbEntry = res.rows[0];
				if(!lbEntry){
					room.broadcast(user, "The leaderboard you specified doesn't exist.", rank);
				}else if(lbEntry.enabled){
					room.broadcast(user, "That leaderboard is already enabled.", rank);
				}else{
					id = lbEntry.id;
					this.pgclient.runSql(UPDATE_LB_SQL, [id, true], (err, res2)=>{
						if(err){
							error(err);
							room.broadcast(user, `Error: ${err}`);
							return;
						}
					
						room.broadcast(user, `Successfully enabled the ${lbEntry.display_name} leaderboard.`, rank);
					});
				}
			});
		}
	},
	disable: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, this.config.manageEventRank.value)){
			room.broadcast(user, "Your rank is not high enough to disable a leaderboard.", rank);
		}else if(args.length<2){
			room.broadcast(user, "You must specify the name for the leaderboard.", rank);
		}else{
			let id = toId(args[1]);
			this.pgclient.runSql(GET_LB_SQL, [id], (err, res)=>{
				if(err){
					error(err);
					room.broadcast(user, `Error: ${err}`);
					return;
				}
			
				let lbEntry = res.rows[0];
				if(!lbEntry){
					room.broadcast(user, "The leaderboard you specified doesn't exist.", rank);
				}else if(!lbEntry.enabled){
					room.broadcast(user, "That leaderboard is already disabled.", rank);
				}else{
					id = lbEntry.id;
					this.pgclient.runSql(UPDATE_LB_SQL, [id, false], (err, res2)=>{
						if(err){
							error(err);
							room.broadcast(user, `Error: ${err}`);
							return;
						}
				
						room.broadcast(user, `Successfully disabled the ${lbEntry.display_name} leaderboard.`, rank);
					});
				}
			});
		}
	}
};

let sayScores = function(scores, lb, room){
	let message = `/addhtmlbox <table style="background-color: #45cc51; margin: 2px 0;border: 2px solid #0d4916;color: black" border=1><tr style="background-color: #209331"><th colspan="2">${scores[0].lb_name}</th></tr><tr style="background-color: #209331"><th style="width: 150px">User</th><th>Score</th></tr>`;
	for(let i=0;i<scores.length;i++){
		message = message + `<tr><td>${scores[i].display_name || scores[i].id1}</td><td>${scores[i].points}</td></tr>`;
	}
	message = message + "</table>"

	room.send(message);
}

class TTL extends BaseModule{
	constructor(){
		super();
		this.room = TTL.room;
		this.config = {
			editScoreRank: new ConfigRank('@'),
			resetLeaderboardRank: new ConfigRank('#'),
			manageEventRank: new ConfigRank('@'),
			scoreWebhook: new ConfigString('')
		};
		this.commands = commands;
		this.dependencies = ['pgclient', 'achievements'];
	}

	onLoad(){
	}

	onUnload(){
	}

	recover(oldModule){
	}
	
	//args is [number of entries to get, leaderboard]
	listLeaderboardEntries(args, callback){
		this.pgclient.runSql(LIST_LB_ENTRIES_SQL.replace("_NUMBER_",args[0]), [toId(args[1])], callback);
	};

	getAllLeaderboardEntries(leaderboard, callback){
		this.pgclient.runSql(GET_ALL_LB_ENTRIES_SQL, [toId(leaderboard)], callback);
	};

	removeAllLeaderboardEntries(dbId, callback, client){
		this.pgclient.runSql(DELETE_USER_ENTRIES_SQL, [dbId], callback, client);
	}
}

TTL.room = 'trivia';

exports.Module = TTL;
