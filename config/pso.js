// TODO: This should come from LeagueConfig in the database
module.exports.season = 2025;

module.exports.auctionUsers = {
	anthony: 'Anthony',
	brett: 'Brett',
	jason: 'Jason',
	justin: 'Justin',
	keyon: 'Keyon',
	kociMueller: 'Koci/Mueller',
	luke: 'Luke',
	mike: 'Mike',
	mitch: 'Mitch',
	patrick: 'Patrick',
	quinn: 'Quinn',
	schexes: 'Schexes'
};

module.exports.nominationOrder = [
	'Anthony',
	'Brett',
	'Jason',
	'Justin',
	'Keyon',
	'Koci/Mueller',
	'Luke',
	'Mike',
	'Mitch',
	'Patrick',
	'Quinn',
	'Schexes'
];

module.exports.franchises = {
	1: 'Patrick',
	2: 'Koci/Mueller',
	3: 'Luke',
	4: 'Justin',
	5: 'Mike',
	6: 'Keyon',
	7: 'Brett',
	8: 'Jason',
	9: 'Schexes',
	10: 'Anthony',
	11: 'Quinn',
	12: 'Mitch'
};

module.exports.franchiseIds = {
	'Patrick': 1,
	'Koci/Mueller': 2,
	'Luke': 3,
	'Justin': 4,
	'Mike': 5,
	'Keyon': 6,
	'Brett': 7,
	'Jason': 8,
	'Schexes': 9,
	'Anthony': 10,
	'Quinn': 11,
	'Mitch': 12
};

module.exports.regimes = {
	// current franchises and which regimes they map to
	'Patrick': 'Patrick',
	'Koci/Mueller': 'Koci/Mueller',
	'Luke': 'Luke',
	'Justin': 'Justin',
	'Mike': 'Mike',
	'Keyon': 'Keyon',
	'Brett': 'Brett',
	'Jason': 'Jason',
	'Schexes': 'Schexes',
	'Anthony': 'Anthony',
	'Quinn': 'Quinn',
	'Mitch': 'Mitch',

	// defunct franchise names that map to their own regimes
	'Charles': 'Charles',
	'Daniel': 'Daniel',
	'James': 'James',
	'Jeff': 'Jeff',
	'John': 'John',
	'Schex': 'Schex',
	'Syed': 'Syed',
	'Terence': 'Terence',
	'Trevor': 'Trevor',

	// defunct franchise names that map to something besides their own regime
	'Brett/Luke': 'Luke',
	'Jake/Luke': 'Luke',
	'James/Charles': 'Charles',
	'John/Zach': 'John',
	'Koci': 'Koci/Mueller',
	'Mitch/Mike': 'Mitch',
	'Pat/Quinn': 'Patrick',
	'Schex/Jeff': 'Schex',
	'Syed/Kuan': 'Syed',
	'Syed/Terence': 'Syed'
};

module.exports.sleeperLeagueIds = {
	2025: '1260741738369130496',
	2024: '1127724654778601472',
	2023: '992120664913969152',
	2022: '817129464579350528',
	2021: '746826510043856896'
};

module.exports.fantraxLeagueId = '39re5lj3mfy64oww';

module.exports.fantraxAbbreviations = {
	'SCHX': 'Schex',
	'RIDD': 'Jason',
	'REYN': 'James/Charles',
	'KOMU': 'Koci/Mueller',
	'SOMA': 'Keyon',
	'PP': 'Trevor',
	'QTM': 'Quinn',
	'pat': 'Patrick',
	'ATTY': 'John/Zach',
	'LUKE': 'Luke',
	'BLEEZ': 'Brett',
	'MTCH': 'Mitch'
};

module.exports.fantraxIds = {
	2020: {
		'motju5wmk7xr9dlz': 1, // (pat) Crucifictorious Maids
		'6u9bwy3ik7xrer9z': 2, // KoMu: Ladies&Gents, the Fabulous Staches
		'hfyfddwck7xrera2': 3, // (Luke) The Folksmen
		'hgfqy84rk7xrera0': 4, // Figrin J'OHN and the Modal Nodes
		'alzk1h56k7xrer9w': 5, // (Trevor) The Greenbay Packers
		'134ej04vk7xrer9y': 6, // (Keyon) Quon T. Hill and the Zits
		'n5ozy8wjk7xrer9m': 7, // Cap'n Geech & The Shrimp Shaq Shooters
		'fzqz34xuk7xrer9p': 8, // (TMAN) Dr Teeth and The Electric Mayhem
		'erk30j3lk7xrer9s': 9, // (REYN) Sex Bob-omb and the City
		'bmj6dbebk7xrer9v': 10, // (SCHX) Onederlic Life to Live
		'a1p22t32k7xrer9u': 11, // (QTM) Tyler Dethklokett
		'vt5py28ck7xrer9r': 12, // Kelce and the Kickers (MITCH)
	},
	2021: {
		'mkljbisnkkyr33yl': 1, // Patrick
		'urd756b0kkyr33yw': 2, // Koci/Mueller
		'dqvvynv8kkyr33yo': 3, // Luke
		'8cdt5li1kkyr33z7': 4, // John/Zach
		'ygmwf6pvkkyr33yu': 5, // Trevor
		'u6hbpnznkkyr33z5': 6, // Keyon
		'xc5epmazkkyr33z2': 7, // Brett
		'qsikxu5lkkyr33yq': 8, // Jason
		'mr9o4eonkkyr33yy': 9, // James/Charles
		'ps1ipdlgkkyr33ys': 10, // Schex
		'hsdnqwgykkyr33yj': 11, // Quinn
		'218fvvbwkkyr33z0': 12 // Mitch
	}
};

module.exports.sheetsBudgetCells = {
	'xc5epmazkkyr33z2': 2, // Brett
	'mr9o4eonkkyr33yy': 3, // James/Charles
	'qsikxu5lkkyr33yq': 4, // Jason
	'8cdt5li1kkyr33z7': 5, // Justin
	'u6hbpnznkkyr33z5': 6, // Keyon
	'urd756b0kkyr33yw': 7, // Koci/Mueller
	'dqvvynv8kkyr33yo': 8, // Luke
	'218fvvbwkkyr33z0': 9, // Mitch/Mike
	'mkljbisnkkyr33yl': 10, // Patrick
	'hsdnqwgykkyr33yj': 11, // Quinn
	'ps1ipdlgkkyr33ys': 12, // Schex
	'ygmwf6pvkkyr33yu': 13 // Trevor
};

module.exports.franchiseNames = {
	1: {
		2025: 'Patrick',
		2024: 'Patrick',
		2023: 'Patrick',
		2022: 'Patrick',
		2021: 'Patrick',
		2020: 'Patrick',
		2019: 'Patrick',
		2018: 'Patrick',
		2017: 'Patrick',
		2016: 'Patrick',
		2015: 'Patrick',
		2014: 'Patrick',
		2013: 'Pat/Quinn',
		2012: 'Pat/Quinn',
		2011: 'Patrick',
		2010: 'Patrick',
		2009: 'Patrick',
		2008: 'Patrick'
	},
	2: {
		2025: 'Koci/Mueller',
		2024: 'Koci/Mueller',
		2023: 'Koci/Mueller',
		2022: 'Koci/Mueller',
		2021: 'Koci/Mueller',
		2020: 'Koci/Mueller',
		2019: 'Koci/Mueller',
		2018: 'Koci/Mueller',
		2017: 'Koci/Mueller',
		2016: 'Koci/Mueller',
		2015: 'Koci/Mueller',
		2014: 'Koci/Mueller',
		2013: 'Koci/Mueller',
		2012: 'Koci',
		2011: 'Koci',
		2010: 'Koci',
		2009: 'Koci',
		2008: 'Koci'
	},
	3: {
		2025: 'Luke',
		2024: 'Luke',
		2023: 'Luke',
		2022: 'Luke',
		2021: 'Luke',
		2020: 'Luke',
		2019: 'Syed/Kuan',
		2018: 'Syed/Terence',
		2017: 'Syed/Terence',
		2016: 'Syed/Terence',
		2015: 'Syed/Terence',
		2014: 'Syed',
		2013: 'Syed',
		2012: 'Syed',
		2011: 'Syed',
		2010: 'Syed',
		2009: 'Syed',
		2008: 'Syed'
	},
	4: {
		2025: 'Justin',
		2024: 'Justin',
		2023: 'Justin',
		2022: 'Justin',
		2021: 'John/Zach',
		2020: 'John/Zach',
		2019: 'John/Zach',
		2018: 'John/Zach',
		2017: 'John/Zach',
		2016: 'John/Zach',
		2015: 'John/Zach',
		2014: 'John/Zach',
		2013: 'John',
		2012: 'John',
		2011: 'John',
		2010: 'John',
		2009: 'John',
		2008: 'John'
	},
	5: {
		2025: 'Mike',
		2024: 'Mike',
		2023: 'Mike',
		2022: 'Trevor',
		2021: 'Trevor',
		2020: 'Trevor',
		2019: 'Trevor',
		2018: 'Trevor',
		2017: 'Trevor',
		2016: 'Trevor',
		2015: 'Trevor',
		2014: 'Trevor',
		2013: 'Trevor',
		2012: 'Trevor',
		2011: 'Trevor',
		2010: 'Trevor',
		2009: 'Trevor',
		2008: 'Trevor'
	},
	6: {
		2025: 'Keyon',
		2024: 'Keyon',
		2023: 'Keyon',
		2022: 'Keyon',
		2021: 'Keyon',
		2020: 'Keyon',
		2019: 'Keyon',
		2018: 'Keyon',
		2017: 'Keyon',
		2016: 'Keyon',
		2015: 'Keyon',
		2014: 'Keyon',
		2013: 'Keyon',
		2012: 'Keyon',
		2011: 'Keyon',
		2010: 'Keyon',
		2009: 'Keyon',
		2008: 'Keyon'
	},
	7: {
		2025: 'Brett',
		2024: 'Brett',
		2023: 'Brett',
		2022: 'Brett',
		2021: 'Brett',
		2020: 'Brett',
		2019: 'Brett/Luke',
		2018: 'Brett/Luke',
		2017: 'Brett/Luke',
		2016: 'Brett/Luke',
		2015: 'Brett/Luke',
		2014: 'Brett/Luke',
		2013: 'Jake/Luke',
		2012: 'Jake/Luke',
		2011: 'Jake/Luke',
		2010: 'Jake/Luke',
		2009: 'Jake/Luke',
		2008: 'Jeff'
	},
	8: {
		2025: 'Jason',
		2024: 'Jason',
		2023: 'Jason',
		2022: 'Jason',
		2021: 'Jason',
		2020: 'Terence',
		2019: 'Terence',
		2018: 'Daniel',
		2017: 'Daniel',
		2016: 'Daniel',
		2015: 'Daniel',
		2014: 'Daniel',
		2013: 'Daniel',
		2012: 'Daniel',
		2011: 'Daniel',
		2010: 'Daniel',
		2009: 'Daniel',
		2008: 'Daniel'
	},
	9: {
		2025: 'Schexes',
		2024: 'Schexes',
		2023: 'James/Charles',
		2022: 'James/Charles',
		2021: 'James/Charles',
		2020: 'James/Charles',
		2019: 'James/Charles',
		2018: 'James/Charles',
		2017: 'James/Charles',
		2016: 'James',
		2015: 'James',
		2014: 'James',
		2013: 'James',
		2012: 'James',
		2011: 'James',
		2010: 'James',
		2009: 'James',
		2008: 'James'
	},
	10: {
		2025: 'Anthony',
		2024: 'Anthony',
		2023: 'Schex',
		2022: 'Schex',
		2021: 'Schex',
		2020: 'Schex',
		2019: 'Schex',
		2018: 'Schex',
		2017: 'Schex/Jeff',
		2016: 'Schex/Jeff',
		2015: 'Schex/Jeff',
		2014: 'Schex',
		2013: 'Schex',
		2012: 'Schex',
		2011: 'Schexes',
		2010: 'Schexes',
		2009: 'Schexes',
		2008: 'Schexes',
	},
	11: {
		2025: 'Quinn',
		2024: 'Quinn',
		2023: 'Quinn',
		2022: 'Quinn',
		2021: 'Quinn',
		2020: 'Quinn',
		2019: 'Quinn',
		2018: 'Quinn',
		2017: 'Quinn',
		2016: 'Quinn',
		2015: 'Quinn',
		2014: 'Quinn',
		2013: 'Charles',
		2012: 'Charles'
	},
	12: {
		2025: 'Mitch',
		2024: 'Mitch',
		2023: 'Mitch',
		2022: 'Mitch/Mike',
		2021: 'Mitch',
		2020: 'Mitch',
		2019: 'Mitch',
		2018: 'Mitch',
		2017: 'Mitch',
		2016: 'Mitch',
		2015: 'Mitch',
		2014: 'Mitch',
		2013: 'Mitch',
		2012: 'Mitch'
	}
};

module.exports.getWeek = function(now = new Date(), seasonYear = module.exports.season) {
	var laborDay = new Date(seasonYear, 8, 1);

	while (laborDay.getDay() !== 1) {
		laborDay.setDate(laborDay.getDate() + 1);
	}

	var firstWednesday = new Date(laborDay);

	while (firstWednesday.getDay() !== 3) {
		firstWednesday.setDate(firstWednesday.getDate() + 1);
	}

	var days = Math.floor((now - firstWednesday) / 86400000);

	var week;

	if (days < 0) {
		week = 1;
	} else if (days < 7) {
		week = 1;
	} else {
		week = Math.floor(days / 7) + 1;
	}

	week = Math.min(week, 17);

	return week;
}
