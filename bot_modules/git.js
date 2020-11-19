let git = require("nodegit");

let commands = {
	git: function(message, args, user, rank, room, commandRank, commandRoom){
		if(!AuthManager.rankgeq(commandRank, '#')){
			room.broadcast(user, "Your rank is not high enough to use that command.", rank);
		}else if(args.length === 0){

		}else{
			let command = args[0].toLowerCase();
			if(gitCommands[command]){
				gitCommands[command].call(this, message, args, user, rank, room, commandRank, commandRoom);
			}
		}
	}
}

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

class Git extends BaseModule{
	constructor(){
		super();
		this.room = Git.room;
		this.config = {};
		this.commands = commands;
	}
}

exports.Module = Git;
