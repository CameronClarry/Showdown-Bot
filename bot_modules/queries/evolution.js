// {{{ EVOLUTION STAT CHANGES

let pokemonByStatChange = function(statId, targetDiff, typeId, question, callback){
	const POKEMON_BY_STAT_CHANGE = `SELECT pokemon.name, pokemon.short_name
	FROM evolutions
	INNER JOIN pokemon ON pokemon.id = evolutions.from_id
	INNER JOIN stats AS prevo_stats ON prevo_stats.pokemon_id = evolutions.from_id
	INNER JOIN stats AS evo_stats ON evo_stats.pokemon_id = evolutions.to_id
	WHERE evo_stats.${statId} - prevo_stats.${statId} = ${targetDiff}
	AND (pokemon.type1_id = ${typeId} OR pokemon.type2_id = ${typeId})`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let answers = rows.map((e)=>{return e.name});

		callback(null, question, answers);
	};
	this.pgclient.runSql(POKEMON_BY_STAT_CHANGE, [], newCallback);
}

let evolutionStatChanges = function(callback){
	let stats = ['hp', 'attack', 'defence', 'special', 'speed']
	let statNames = ['HP', 'Attack', 'Defence', 'Special', 'Speed']
	let i = Math.floor(Math.random()*stats.length);
	let statId = stats[i];
	let statName = statNames[i];
	const EVO_STAT_CHANGES = `WITH stat_changes AS (
		SELECT evo_stats.${statId} - prevo_stats.${statId} AS diff, pokemon.type1_id AS type_id, pokemon.name
		FROM evolutions
		INNER JOIN stats AS prevo_stats ON prevo_stats.pokemon_id = evolutions.from_id
		INNER JOIN stats AS evo_stats ON evo_stats.pokemon_id = evolutions.to_id
		INNER JOIN pokemon ON pokemon.id = evolutions.from_id
		UNION ALL
		SELECT evo_stats.${statId} - prevo_stats.${statId} AS diff, pokemon.type2_id AS type_id, pokemon.name
		FROM evolutions
		INNER JOIN stats AS prevo_stats ON prevo_stats.pokemon_id = evolutions.from_id
		INNER JOIN stats AS evo_stats ON evo_stats.pokemon_id = evolutions.to_id
		INNER JOIN pokemon ON pokemon.id = evolutions.from_id
		WHERE pokemon.type2_id IS NOT NULL
	)
	SELECT type_id, types.name AS type_name, MAX(diff) AS max_diff, MIN(diff) AS min_diff
	FROM stat_changes
	INNER JOIN types ON types.id = stat_changes.type_id
	GROUP BY type_id, type_name`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let row = rows[Math.floor(Math.random()*rows.length)];
		let question, targetChange;

		if(Math.random() < 0.1){
			// Ask which increases the least/decreases the most
			targetChange = row.min_diff;
			let change = targetChange < 0 ? `decreases the most` : `increases the least`;
			question = `In Generation I, this Pokemon's ${statName} stat ${change} of all ${row.type_name} types when evolving.`;
		}else{
			// Ask which increases the most
			targetChange = row.max_diff;
			question = `In Generation I, this Pokemon's ${statName} stat increases the most of all ${row.type_name} types when evolving.`;
		}

		pokemonByStatChange.call(this, statId, targetChange, row.type_id, question, callback);
	};
	this.pgclient.runSql(EVO_STAT_CHANGES, [], newCallback);
}

// }}}

// {{{ EVOLUTION TYPE CHANGES

let evolutionTypeChanges = function(callback){
	const EVO_TYPE_CHANGES = `SELECT prevo.name AS prevo_name, evo.name AS evo_name, 
	prevo_t1.name AS prevo_t1, prevo_t2.name AS prevo_t2, evo_t1.name AS evo_t1, evo_t2.name AS evo_t2
	FROM evolutions
	INNER JOIN pokemon AS prevo ON prevo.id = evolutions.from_id
	INNER JOIN pokemon AS evo ON evo.id = evolutions.to_id
	LEFT OUTER JOIN types AS prevo_t1 ON prevo_t1.id = prevo.type1_id
	LEFT OUTER JOIN types AS prevo_t2 ON prevo_t2.id = prevo.type2_id
	LEFT OUTER JOIN types AS evo_t1 ON evo_t1.id = evo.type1_id
	LEFT OUTER JOIN types AS evo_t2 ON evo_t2.id = evo.type2_id
	WHERE (prevo.type1_id IS DISTINCT FROM evo.type1_id OR prevo.type2_id IS DISTINCT FROM evo.type2_id)`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let row = rows[Math.floor(Math.random()*rows.length)];
		let question, answers, targetChange;

		if(row.prevo_t1 === row.evo_t1 && !row.prevo_t2 && row.evo_t2){
			// Ask for mons which gained t2
			question = `In Generation I, this Pokemon gained ${row.evo_t2} as a secondary typing when evolving.`
			let filteredRows = rows.filter((e)=>{return e.evo_t2 === row.evo_t2 && !e.prevo_t2});
			answers = filteredRows.map((e)=>{return e.prevo_name});
		}else if(row.prevo_t1 !== row.evo_t1){
			// Ask which pokemon changes primary type
			question = `In Generation I, this Pokemon changes its primary type when evolving.`;
			let filteredRows = rows.filter((e)=>{return e.prevo_t1 !== e.evo_t1});
			answers = filteredRows.map((e)=>{return e.prevo_name});
		}else{
			// Ask which pokemon changes type as a fallback
			question = `In Generation I, this Pokemon changes type when evolving.`;
			answers = rows.map((e)=>{return e.prevo_name});
		}

		callback(null, question, answers);
	};
	this.pgclient.runSql(EVO_TYPE_CHANGES, [], newCallback);
}

// }}}

// {{{ EVOLUTION MOVE DIFFERENCES

let evolutionMoveChanges = function(callback){
	const EVO_TYPE_CHANGES = `WITH evo_numbers AS (
		SELECT from_id, COUNT(DISTINCT to_id) AS evo_count
		FROM evolutions
		GROUP BY from_id
	)
	SELECT prevo.name AS pokemon_name, moves.name AS move_name, moves.id, COUNT(DISTINCT evolutions.to_id)::int, MAX(evo_numbers.evo_count)::int
	FROM evolutions
	INNER JOIN evo_numbers ON evo_numbers.from_id = evolutions.from_id
	INNER JOIN pokemon AS prevo ON prevo.id = evolutions.from_id
	INNER JOIN movesets AS prevo_moves ON prevo_moves.pokemon_id = evolutions.from_id AND prevo_moves.learn_method = 1
	INNER JOIN moves ON moves.id = prevo_moves.move_id
	LEFT JOIN movesets AS evo_moves ON evo_moves.pokemon_id = evolutions.to_id AND evo_moves.move_id = prevo_moves.move_id AND evo_moves.learn_method = 1
	WHERE evo_moves.move_id IS NULL
	GROUP BY prevo.name, moves.name, moves.id`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let filteredRows = rows.filter(e=>{return e.count === e.max});
		let row = filteredRows[Math.floor(Math.random()*filteredRows.length)];

		let question = `In Generation I, this Pokemon learns ${row.move_name} by level up but its evolution does not.`;

		let answers = rows.filter(e=>{return e.id === row.id}).map(e=>{return e.pokemon_name});

		callback(null, question, answers);
	};
	this.pgclient.runSql(EVO_TYPE_CHANGES, [], newCallback);
}
	
// }}}

exports.questionTypes = [
	{
		func: evolutionStatChanges,
		weight: 3
	},
	{
		func: evolutionTypeChanges,
		weight: 3
	},
	{
		func: evolutionMoveChanges,
		weight: 3
	}
];
