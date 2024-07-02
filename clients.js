const express = require("express");
const router = express.Router();
const fs = require("fs");

const Kpp = require("../models/kpps");
const Clients = require("../models/clients");
const catchAsync = require("../utils/catchAsync");
const { validateClient, isLoggedIn, isSuperUser } = require("../middleware");
const { Stream } = require("stream");
const { join } = require("path");
const e = require("connect-flash");
const clients = require("../models/clients");
const { translit } = require("../utils/translit");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const { logging } = require("../utils/logging");

router.get(
	"/",
	isLoggedIn,
	catchAsync(async (req, res) => {
		const { page = 1, limit = 25 } = req.query;

		const total = await Clients.find({}).count();
		const pages = Math.ceil(total / limit);
		const startFrom = (page - 1) * limit;
		const prevPage = page <= 1 ? 1 : parseInt(page) - 1;
		const nextPage = page >= pages ? pages : parseInt(page) + 1;
		const clients = await Clients.find({})
			.skip(startFrom)
			.limit(limit)
			.sort({ expirationDate: 1 });
		let startPage = parseInt(page) - 2;
		let endPage = parseInt(page) + 2;
		if (page <= 2) {
			startPage = 1;
			endPage = parseInt(page) + (5 - page);
		} else if (page >= pages - 2) {
			startPage = pages - 4;
			endPage = pages;
		}
		if (pages <= 5) {
			startPage = 1;
			endPage = pages;
		}
		res.render("clients/showAll", {
			clients,
			pages,
			page: parseInt(page),
			prevPage,
			nextPage,
			startPage,
			endPage,
			limit,
			total,
		});
	})
);

router.get("/import", isLoggedIn, isSuperUser, (req, res) => {
	res.render("clients/import");
});
router.post(
	"/import",
	isLoggedIn,
	isSuperUser,
	upload.single("data"),
	async (req, res) => {
		const path = `./${req.file.destination}${req.file.filename}`;
		const clientsJson = fs.readFileSync(path, "utf-8");
		const clientsObj = JSON.parse(clientsJson);

		const kpps = await Kpp.find({}, { _id: 1 });
		for (let kpp of kpps) {
			await Kpp.findByIdAndUpdate(kpp._id, { clients: [] });
		}
		await Clients.deleteMany({});
		for (let clientObj of clientsObj) {
			const { parking, ...client } = clientObj;
			const importClient = new Clients(client);
			parking.map(async (kpp) => {
				await Kpp.findOneAndUpdate(
					{ name: kpp },
					{ $push: { clients: importClient } }
				);
			});
			await importClient.save();
		}

		res.redirect("/kpps/clients/import");
	}
);

router.get("/export", isLoggedIn, isSuperUser, (req, res) => {
	res.render("clients/export");
});

router.post("/export", isLoggedIn, isSuperUser, async (req, res) => {
	const { eldes } = req.body;
	if (eldes && req.body.parking !== "all") {
		const kppFull = await Kpp.findOne({ name: req.body.parking }).populate(
			"clients"
		);
		const csvHeaders = [
			"User Name",
			"Tel Number",
			"Relay No.",
			"Sch.1 (1-true 0-false)",
			"Sch.2 (1-true 0-false)",
			"Sch.3 (1-true 0-false)",
			"Sch.4 (1-true 0-false)",
			"Sch.5 (1-true 0-false)",
			"Sch.6 (1-true 0-false)",
			"Sch.7 (1-true 0-false)",
			"Sch.8 (1-true 0-false)",
			"Year (Valid until)",
			"Month (Valid until)",
			"Day (Valid until)",
			"Hour (Valid until)",
			"Minute (Valid until)",
			"Ring Counter",
			"Ring Counter Status",
		];

		let csvValues = [];
		kppFull.clients.map((item) => {
			for (let phone of item.phone) {
				let phoneIndex = item.phone.indexOf(phone);
				if (!item.labels[phoneIndex].includes(kppFull.name)) {
					continue;
				}
				let date = new Date(item.expirationDate);

				const client = [
					`${translit(item.lastName)} ${translit(
						item.firstName[0]
					)}.${translit(item.fatherhood[0])}.`,
					phone,
					"1",
					"0",
					"0",
					"0",
					"0",
					"0",
					"0",
					"0",
					"0",
					item.expirationDate ? date.getFullYear() : "",
					item.expirationDate ? date.getMonth() + 1 : "",
					item.expirationDate ? date.getDate() : "",
					item.expirationDate ? "0" : "",
					item.expirationDate ? "0" : "",
					"",
					"",
				];
				csvValues.push(client);
			}
		});

		const csvFile = [csvHeaders, ...csvValues]
			.map((e) => e.join(";"))
			.join("\n");

		res.header("Content-Type", "text/csv");
		res.attachment(`${req.body.parking}.csv`);

		res.send(csvFile);
	} else if (req.body.parking !== "all") {
		const kppFull = await Kpp.findOne({ name: req.body.parking }).populate(
			"clients"
		);
		const csvHeaders = [
			"LastName",
			"FirstName",
			"Fatherhood",
			"Phone",
			"ExpirationDate",
			"DataBasePhone",
			"Info",
			"Kpp",
		];
		const csvValues = kppFull.clients.map((item) => {
			let date = new Date(item.expirationDate);
			return [
				item.lastName,
				item.firstName,
				item.fatherhood,
				item.phone,
				item.expirationDate
					? `${date.getDate()}.${
							date.getMonth() + 1
					  }.${date.getFullYear()}`
					: "",
				item.dbPhone,
				item.info,
				req.body.parking,
			];
		});

		const csvFile = [csvHeaders, ...csvValues]
			.map((e) => e.join(";"))
			.join("\n");

		res.setHeader("Content-Type", "text/csv");
		res.setHeader("charset", "utf-8");

		res.attachment(`${req.body.parking}.csv`);

		res.send(csvFile);
	} else {
		const clientsAll = await Clients.find({}).lean();

		const kppAll = await Kpp.find({}).populate("clients").lean();

		// for (let client of clientsAll) {
		// 	const parking = [];
		// 	kppAll.map((kpp) => {
		// 		if (
		// 			kpp.clients.find(
		// 				(kppClient) =>
		// 					JSON.stringify(kppClient) === JSON.stringify(client)
		// 			)
		// 		) {
		// 			parking.push(kpp.name);
		// 		}
		// 	});
		// 	client.parking = parking;
		// }

		const clientStrings = new Set(clientsAll.map(client => JSON.stringify(client)));

		// Iterate through each KPP and build a map of KPP names to clients
		const kppClientMap = new Map();
		kppAll.forEach(kpp => {
			kpp.clients.forEach(kppClient => {
				const kppClientStr = JSON.stringify(kppClient);
				if (clientStrings.has(kppClientStr)) {
					if (!kppClientMap.has(kppClientStr)) {
						kppClientMap.set(kppClientStr, []);
					}
					kppClientMap.get(kppClientStr).push(kpp.name);
				}
			});
		});

		// Assign parking to each client
		clientsAll.forEach(client => {
			const clientStr = JSON.stringify(client);
			client.parking = kppClientMap.get(clientStr) || [];
		});

		const csvHeaders = [
			"_id",
			"lastName",
			"firstName",
			"fatherhood",
			"phone",
			"expirationDate",
			"dbPhone",
			"info",
			"parking",
			"labels",
		];
		const csvValues = clientsAll.map((item) => {
			let date = new Date(item.expirationDate);
			return [
				item._id,
				item.lastName,
				item.firstName,
				item.fatherhood,
				item.phone,
				item.expirationDate
					? `${date.getDate()}.${
							date.getMonth() + 1
					  }.${date.getFullYear()}`
					: "",
				item.dbPhone,
				item.info,
				item.parking,
				item.labels,
			];
		});

		const csvFile = [csvHeaders, ...csvValues]
			.map((e) => e.join(";"))
			.join("\n");

		// res.header({ "Content-Type": "text/csv", charset: "windows-1252" });
		// res.header("Content-Type", "text/csv");
		res.header("Content-Type", "application/json");
		res.attachment("fileName.json");

		res.send(clientsAll);
		//res.render("clients/export");
	}
});

router.get("/search", async (req, res) => {
	const searchQuery = req.query;
	const { page = 1, limit = 25 } = req.query;
	const total = await Clients.find({
		$or: [
			{ lastName: { $regex: searchQuery.search, $options: "i" } },
			{ phone: { $regex: searchQuery.search, $options: "i" } },
		],
	}).count();
	const pages = Math.ceil(total / limit);
	const startFrom = (page - 1) * limit;
	const prevPage = page <= 1 ? 1 : parseInt(page) - 1;
	const nextPage = page >= pages ? pages : parseInt(page) + 1;
	// let searchResult = await Clients.find({ lastName: searchQuery.search });
	let clients = await Clients.find({
		$or: [
			{ lastName: { $regex: searchQuery.search, $options: "i" } },
			{ phone: { $regex: searchQuery.search, $options: "i" } },
		],
	})
		.skip(startFrom)
		.limit(limit)
		.sort({ expirationDate: 1 });

	let startPage = parseInt(page) - 2;
	let endPage = parseInt(page) + 2;
	if (page <= 2) {
		startPage = 1;
		endPage = parseInt(page) + (5 - page);
	} else if (page >= pages - 2) {
		startPage = pages - 4;
		endPage = pages;
	}
	if (pages <= 5) {
		startPage = 1;
		endPage = pages;
	}
	res.render("clients/searchRes", {
		clients,
		pages,
		page: parseInt(page),
		prevPage,
		nextPage,
		startPage,
		endPage,
		limit,
		total,
		searchQuery: searchQuery.search,
	});
});

router.get("/newClient", isLoggedIn, isSuperUser, async (req, res) => {
	res.render("clients/new");
});

router.post(
	"/newClient",
	isLoggedIn,
	isSuperUser,
	validateClient,
	catchAsync(async (req, res) => {
		const { kpps, ...client } = req.body.client;
		logging("NEW", client, req.user.username);
		const checkClient = await Clients.findOne({
			lastName: client.lastName.toLowerCase(),
			firstName: client.firstName.toLowerCase(),
			fatherhood: client.fatherhood.toLowerCase(),
		});

		!client.expirationDate
			? (client.expirationDate = new Date("2050,1,1"))
			: "";
		const originalDate = new Date(client.expirationDate);

		client.expirationDate = originalDate.setDate(
			originalDate.getDate() + 30
		);

		if (checkClient) {
			res.redirect(`/kpps/clients/edit/${checkClient._id}`);
		} else {
			const kppName = Object.keys(kpps);
			const newClient = new Clients(client);
			await newClient.save();

			kppName.map(async (kpp) => {
				const currentKpp = await Kpp.findOne({ name: kpp });
				currentKpp.clients.push(newClient);
				await currentKpp.save();
			});
			req.flash("success", "Клиент добавлен в Базу Данных.");
			res.redirect("/kpps/clients/newClient");
		}
	})
);

router.delete(
	"/:clientId",
	isLoggedIn,
	isSuperUser,
	catchAsync(async (req, res) => {
		const kppsBase = await Kpp.find({ clients: req.params.clientId });
		const client = await Clients.findById(req.params.clientId);
		logging("DELETE", client, req.user.username);
		kppsBase.map(async (kpp) => {
			await Kpp.findByIdAndUpdate(kpp._id, {
				$pull: { clients: req.params.clientId },
			});
		});
		await Clients.findByIdAndDelete(req.params.clientId);
		req.flash("success", "Клиент удален из Базы Данных.");
		const redirectUrl = req.session.returnTo || "/kpps/clients";
		delete req.session.returnTo;
		res.redirect(redirectUrl);
	})
);

router.get(
	"/edit/:clientId",
	isLoggedIn,
	isSuperUser,
	catchAsync(async (req, res) => {
		const c_client = await Clients.findById(req.params.clientId);
		const kpps = await Kpp.find({ clients: c_client._id }, { name: 1 });
		const kppsName = kpps.map((kpp) => kpp.name);
		const returnTo = req.session.returnTo;
		res.render("clients/edit", {
			c_client,
			kppsName,
			returnTo,
		});
	})
);
router.get(
	"/:clientId",
	isLoggedIn,
	catchAsync(async (req, res) => {
		const c_client = await Clients.findById(req.params.clientId);
		const kpps = await Kpp.find({ clients: c_client._id }, { name: 1 });
		const kppsName = kpps.map((kpp) => kpp.name);
		const returnTo = req.session.returnTo;
		res.render("clients/show", {
			c_client,
			kppsName,
			returnTo,
		});
	})
);

router.put(
	"/:clientId",
	isLoggedIn,
	isSuperUser,
	validateClient,
	catchAsync(async (req, res) => {
		const { kpps, dontChangeDate, ...client } = req.body.client;
		logging(req.method, client, req.user.username);
		!client.labels ? (client.labels = []) : "";
		!client.hidden ? (client.hidden = "off") : "";
		!client.expirationDate
			? (client.expirationDate = new Date("2050,1,1"))
			: "";

		const originalDate = new Date(client.expirationDate);
		if (!dontChangeDate) {
			client.expirationDate = originalDate.setDate(
				originalDate.getDate() + 30
			);
		}

		const updateClient = await Clients.findByIdAndUpdate(
			req.params.clientId,
			client,
			{ runValidators: true, new: true }
		);
		const kppsBase = await Kpp.find({ clients: req.params.clientId });
		const kppsNames = kppsBase.map((kpp) => kpp.name);
		kppsBase.map(
			catchAsync(async (kpp) => {
				Object.values(kpps).includes(kpp.name)
					? " "
					: await Kpp.findByIdAndUpdate(kpp._id, {
							$pull: { clients: req.params.clientId },
					  });
			})
		);
		Object.values(kpps).map(async (kpp) => {
			if (kppsNames.includes(kpp)) {
				("");
			} else {
				const addToKpp = await Kpp.findOne({ name: kpp });
				addToKpp.clients.push(updateClient);
				await addToKpp.save();
			}
		});
		req.flash("success", "Данные клиента обновлены.");
		const redirectUrl = req.session.returnTo || "/kpps/clients";
		delete req.session.returnTo;

		res.redirect(redirectUrl);
	})
);

module.exports = router;
