// {{{ EVOLUTION STAT CHANGES

let pokemonByStatChange = function(statId, targetDiff, question, genSchema, genName, callback){
	const POKEMON_BY_STAT_CHANGE = `SELECT pokemon.name, pokemon.short_name
	FROM ${genSchema}.evolutions
	INNER JOIN ${genSchema}.pokemon ON pokemon.id = evolutions.from_id
	INNER JOIN ${genSchema}.stats AS prevo_stats ON prevo_stats.pokemon_id = evolutions.from_id
	INNER JOIN ${genSchema}.stats AS evo_stats ON evo_stats.pokemon_id = evolutions.to_id
	WHERE evo_stats.${statId} - prevo_stats.${statId} = ${targetDiff}`;

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

let evolutionStatChanges = function(genSchema, genName, callback){
	let stats = genSchema === 'gen1' ? ['hp', 'atk', 'def', 'sp', 'spe'] : ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
	let statNames = genSchema === 'gen1' ? ['HP', 'Attack', 'Defence', 'Special', 'Speed'] : ['HP', 'Attack', 'Defence', 'Special Attack', 'Special Defence', 'Speed'];
	let i = Math.floor(Math.random()*stats.length);
	let statId = stats[i];
	let statName = statNames[i];
	const EVO_STAT_CHANGES = `WITH stat_changes AS (
		SELECT evo_stats.${statId} - prevo_stats.${statId} AS diff, pokemon.name
		FROM ${genSchema}.evolutions
		INNER JOIN ${genSchema}.stats AS prevo_stats ON prevo_stats.pokemon_id = evolutions.from_id
		INNER JOIN ${genSchema}.stats AS evo_stats ON evo_stats.pokemon_id = evolutions.to_id
		INNER JOIN ${genSchema}.pokemon ON pokemon.id = evolutions.from_id
	)
	SELECT MAX(diff) AS max_diff, MIN(diff) AS min_diff
	FROM stat_changes`;

	let newCallback = (err, res) =>{
		if(err){
			callback(err);
			return;
		}

		// Get array of rows and pick one randomly
		let rows = res.rows;
		let row = rows[Math.floor(Math.random()*rows.length)];
		let question, targetChange;

		if(Math.random() < 0.3){
			// Ask which increases the least/decreases the most
			targetChange = row.min_diff;
			let change = targetChange < 0 ? `the largest decrease` : (targetChange > 0 ? `the smallest increase` : `no change`);
			question = `In Generation ${genName}, this Pokemon has ${change} in ${statName} when it evolves.`;
		}else{
			// Ask which increases the most
			targetChange = row.max_diff;
			question = `In Generation ${genName}, this Pokemon has the largest increase in ${statName} when it evolves.`;
		}

		pokemonByStatChange.call(this, statId, targetChange, question, genSchema, genName, callback);
	};
	this.pgclient.runSql(EVO_STAT_CHANGES, [], newCallback);
}

// }}}

// {{{ EVOLUTION TYPE CHANGES

let evolutionTypeChanges = function(genSchema, genName, callback){
	const EVO_TYPE_CHANGES = `SELECT prevo.name AS prevo_name, evo.name AS evo_name, 
	prevo_t1.name AS prevo_t1, prevo_t2.name AS prevo_t2, evo_t1.name AS evo_t1, evo_t2.name AS evo_t2
	FROM ${genSchema}.evolutions
	INNER JOIN ${genSchema}.pokemon AS prevo ON prevo.id = evolutions.from_id
	INNER JOIN ${genSchema}.pokemon AS evo ON evo.id = evolutions.to_id
	LEFT OUTER JOIN ${genSchema}.types AS prevo_t1 ON prevo_t1.id = prevo.type1_id
	LEFT OUTER JOIN ${genSchema}.types AS prevo_t2 ON prevo_t2.id = prevo.type2_id
	LEFT OUTER JOIN ${genSchema}.types AS evo_t1 ON evo_t1.id = evo.type1_id
	LEFT OUTER JOIN ${genSchema}.types AS evo_t2 ON evo_t2.id = evo.type2_id
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
			question = `In Generation ${genName}, this Pokemon gained ${row.evo_t2} as a secondary typing when evolving.`
			let filteredRows = rows.filter((e)=>{return e.evo_t2 === row.evo_t2 && !e.prevo_t2});
			answers = filteredRows.map((e)=>{return e.prevo_name});
		}else if(row.prevo_t1 !== row.evo_t1){
			// Ask which pokemon changes primary type
			question = `In Generation ${genName}, this Pokemon changes its primary type to ${row.evo_t1} when evolving.`;
			let filteredRows = rows.filter((e)=>{return e.prevo_t1 !== e.evo_t1 && e.evo_t1 === row.evo_t1});
			answers = filteredRows.map((e)=>{return e.prevo_name});
		}else if(row.prevo_t2 !== row.evo_t2 && row.evo_t2 && row.prevo_t2){
			// Ask which mons changes their secondary type
			question = `In Generation ${genName}, this Pokemon changes its secondary type to ${row.evo_t2} when evolving.`;
			let filteredRows = rows.filter((e)=>{return e.prevo_t2 && e.prevo_t2 !== row.evo_t2 && e.evo_t2 === row.evo_t2});
			answers = filteredRows.map((e)=>{return e.prevo_name});
		}else{
			// Ask which mons lost their secondary typing
			question = `In Generation ${genName}, this Pokemon loses its secondary ${row.prevo_t2} typing when it evolves.`;
			let filteredRows = rows.filter((e)=>{return e.prevo_t2 == row.prevo_t2 && !e.evo_t2});
			answers = filteredRows.map((e)=>{return e.prevo_name});
		}

		callback(null, question, answers);
	};
	this.pgclient.runSql(EVO_TYPE_CHANGES, [], newCallback);
}

// }}}

// {{{ EVOLUTION MOVE DIFFERENCES

let evolutionMoveChanges = function(genSchema, genName, callback){
	const EVO_TYPE_CHANGES = `WITH evo_numbers AS (
		SELECT from_id, COUNT(DISTINCT to_id) AS evo_count
		FROM ${genSchema}.evolutions
		GROUP BY from_id
	)
	SELECT prevo.name AS pokemon_name, moves.name AS move_name, moves.id, COUNT(DISTINCT evolutions.to_id)::int, MAX(evo_numbers.evo_count)::int
	FROM ${genSchema}.evolutions
	INNER JOIN evo_numbers ON evo_numbers.from_id = evolutions.from_id
	INNER JOIN ${genSchema}.pokemon AS prevo ON prevo.id = evolutions.from_id
	INNER JOIN ${genSchema}.movesets AS prevo_moves ON prevo_moves.pokemon_id = evolutions.from_id AND prevo_moves.learn_method = 1
	INNER JOIN ${genSchema}.moves ON moves.id = prevo_moves.move_id
	LEFT JOIN ${genSchema}.movesets AS evo_moves ON evo_moves.pokemon_id = evolutions.to_id AND evo_moves.move_id = prevo_moves.move_id AND evo_moves.learn_method = 1
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

		let question = `In Generation ${genName}, this Pokemon learns ${row.move_name} by level up but its evolution does not.`;

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
