let self = {js:{},data:{},requiredBy:[],hooks:{},config:{}};
let git = require("nodegit");
let repository;
let auth;
let chat;
exports.onLoad = function(module, loadData){
	self = module;
	self.js.refreshDependencies();
	if(loadData){
		self.data = {};
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
					if(commands[command]&&auth&&auth.js&&chat&&chat.js){
						let rank = auth.js.getEffectiveRoomRank(m, "Global");
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
	auth = getModuleForDependency("auth", "git");
	chat = getModuleForDependency("chat", "git");
};

exports.onConnect = function(){

};

let commands = {
	git: function(message, args, rank){
		if(auth.js.rankgeq(rank, "#")){
			if(args.length>0){
				let command = args[0].toLowerCase();
				if(gitCommands[command]){
					gitCommands[command](message, args.slice(1), rank);
				}
			}
		}else{
			chat.js.reply(message, "Your rank is not high enough to use that command.");
		}
	}
}

let gitCommands = {
	reset: function(message, args, rank){
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
			chat.js.reply(message, "Reset finished.");
		});
	},
	latest: function(message, args, rank){
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
			return chat.js.reply(message, "This is the latest commit (" + originHeadCommit.date().toUTCString() + "): " + originHeadCommit.summary());
		});
	},
	diff: function(message, args, rank){
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
				chat.js.reply(message, "There are no differences.");
				return;
			}else{
				return arrayDiff[0].patches();
			}
		}).done(function(arrayConvenientPatch){
			if(arrayConvenientPatch.length === 0){
				chat.js.reply("No files were changed.");
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
				chat.js.reply(message, response);
			}
		});
	},
	gud: function(message, args, rank){
		chat.js.reply(message, "no u");
	}
};

let defaultConfigs = {
};

exports.defaultConfigs = defaultConfigs;

let configTypes = {
};

exports.configTypes = configTypes;
