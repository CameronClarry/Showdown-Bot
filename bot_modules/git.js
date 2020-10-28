let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let data = {};
let config = defaultConfigs;
let git = require("nodegit");

const GOVERNING_ROOM = "trivia"
exports.GOVERNING_ROOM = GOVERNING_ROOM

exports.onLoad = function(module, loadData, oldData){
	self = module;
	refreshDependencies();
	if(oldData) data = oldData;
	if(loadData){
		data = {};
	}
};

exports.onUnload = function(){

};

let refreshDependencies = function(){
};
exports.refreshDependencies = refreshDependencies;

exports.onConnect = function(){

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

let commands = {
	git: function(message, args, user, rank, room, commandRank, commandRoom){
		if(AuthManager.rankgeq(commandRank, "#")){
			if(args.length>0){
				let command = args[0].toLowerCase();
				if(gitCommands[command]){
					gitCommands[command](message, args, user, rank, room, commandRank, commandRoom);
				}
			}
		}else{
			room.broadcast(user, "Your rank is not high enough to use that command.", rank);
		}
	}
}

self.commands = commands;
exports.commands = commands;

let gitCommands = {
	reset: function(message, args, user, rank, room, commandRank, commandRoom){
		let repository;
		git.Repository.open(cwd)
		.then(function(repo) {
			repository = repo;
			return repository.fetch('origin');
		})
		.then(function() {
			return repository.getBranchCommit('origin/HEAD');
		})
		.then(function(originHeadCommit) {
			return git.Reset.reset(repository, originHeadCommit, git.Reset.TYPE.HARD);
		})
		.done(function(repo) {
			room.broadcast(user, "Reset finished.", rank);
		});
	},
	latest: function(message, args, user, rank, room, commandRank, commandRoom){
		let repository;
		git.Repository.open(cwd)
		.then(function(repo) {
			repository = repo;
			return repository.fetch('origin');
		})
		.then(function() {
			return repository.getBranchCommit('origin/HEAD');
		})
		.done(function(originHeadCommit) {
			room.broadcast(user, `This is the latest commit (${originHeadCommit.date().toUTCString()}): ${originHeadCommit.summary()}`, rank);
		});
	},
	diff: function(message, args, user, rank, room, commandRank, commandRoom){
		let repository;
		git.Repository.open(cwd)
		.then(function(repo){
			repository = repo;
			return repository.fetch('origin');
		})
		.then(function(){
			return repository.getBranchCommit('origin/HEAD');
		})
		.then(function(originHeadCommit){
			return originHeadCommit.getDiff();
		})
		.then(function(arrayDiff){
			if(arrayDiff.length === 0){
				room.broadcast(user, "There are no differences.", rank);
				return;
			}else{
				return arrayDiff[0].patches();
			}
		}).done(function(arrayConvenientPatch){
			if(arrayConvenientPatch.length === 0){
				room.broadcast(user, "No files were changed.", rank);
			}else{
				let response = "The following files were changed: "
				for(let i=0;i<arrayConvenientPatch.length;i++){
					let pathParts = arrayConvenientPatch[i].newFile().path().split("/");
					let fileName = pathParts[pathParts.length-1];
					if(response.length + fileName.length < 280){
						response += fileName + (i != arrayConvenientPatch.length-1 ? ", " : "");
					}else{
						response += " and " + (arrayConvenientPatch.length - i) + " more.";
					}
				}
				room.broadcast(user, response, rank);
			}
		});
	},
	gud: function(message, args, user, rank, room, commandRank, commandRoom){
		room.broadcast(user, "no u", rank);
	}
};

let defaultConfigs = {
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
};

exports.configTypes = configTypes;
