let fs = require('fs');
let ranks = [" ", "★", "+", "%", "@", "*", "&", "#", "~"];


exports.AuthManager = class{
    constructor(){
        this.userAuth = {};
        this.userAuth[toId(mainConfig.owner)] = {Global:"~"};
    }

    //returns true iff rank1 and rank2 are valid ranks, and rank1>=rank2
    rankgeq(rank1, rank2){
        let i1 = ranks.indexOf(rank1);
        let i2 = ranks.indexOf(rank2);
        return i1 !== -1 && i2 !== -1 && i1 >= i2;
    }
    
    //returns true iff rank1 and rank2 are valid ranks, and rank1>rank2
    rankg(rank1, rank2){
        let i1 = ranks.indexOf(rank1);
        let i2 = ranks.indexOf(rank2);
        return i1 !== -1 && i2 !== -1 && i1 > i2;
    }

    getTopRank(rankList){
        if(rankList.length===0) return " ";
        let curRank = " ";
        for(let i=0;i<rankList.length;i++){
            if(this.rankg(rankList[i],curRank)){
                curRank = rankList[i];
            }
        }
        return curRank;
    }

    //Gets a user's rank, combining actual site ranks with the internal rank list
    getRank(user, room){
        if(!user || !room) return " ";
        let userId = user.id;
        user = room.getUserData(userId);
        let serverRank = user ? user.rank : " ";
        let internalRoomRank = this.userAuth[userId] ? this.userAuth[userId][room.id] : " ";
        let internalGlobalRank = this.userAuth[userId] ? this.userAuth[userId].Global : " ";
        return this.getTopRank([serverRank, internalRoomRank, internalGlobalRank]);
    }

    //Gets a user's rank using only true site ranks
    getTrueRoomRank(user, room){
        if(!user || !room) return " ";
        user = room.getUserData(user.id);
        return user ? user.rank : " ";
    }

    loadAuth(path){
        try{
            let ownerId = toId(mainConfig.owner);
            let userAuth = JSON.parse(fs.readFileSync(path, "utf8"));
            if(!userAuth[ownerId]||userAuth[ownerId].Global!=="~"){
                userAuth[ownerId] = {
                    Global: "~"
                };
            }
            this.userAuth = this.userAuth
        }catch(e){
            error(e.message);
        }
    }

    saveAuth(path){
        try{
            let authFile = fs.openSync(path,"w");
            fs.writeSync(authFile,JSON.stringify(this.userAuth, null, "\t"));
            fs.closeSync(authFile);
        }catch(e){
            error(e.message);
        }
    }
}