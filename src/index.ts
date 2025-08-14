import axios from "axios";
import "dotenv/config";
import fastify from "fastify";
import NodeCache from "node-cache";
import z from "zod";
import { StreamerSchema } from "./models/streamers";

const envSchema = z.object({
  PORT: z
    .string()
    .optional()
    .default("3000")
    .transform((data) => parseInt(data)),
  DB_PORT: z
    .string()
    .optional()
    .default("5432")
    .transform((data) => parseInt(data)),
  DB_URL: z.string().min(1, "Database URL is required"),
  RIOT_API: z.string().min(1, "Riot API key is required"),
});

const env = envSchema.parse(process.env);
const { PORT: port } = env;

import "./config/db";
const cache = new NodeCache({ stdTTL: 60 * 60 });

async function getEloByPuuid(
  puuid: string,
  server: string,
): Promise<{ tier: string; rank: "I" | "II" | "III"; lp: number }> {
  const cacheKey = `elo-${puuid}`;
  const cached = cache.get(cacheKey);

  // if (cached) {
  //   return cached;
  // }

  const r = await axios.get(
    `https://${server}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}?api_key=${env.RIOT_API}`,
  );

  if (r.status !== 200) {
    throw new Error(`Failed to fetch account data: ${r.statusText}`);
  }

  const soloq = r.data.find((d: any) => d.queueType === "RANKED_SOLO_5x5");

  if (!soloq) {
    return { tier: "UNRANKED", rank: "I", lp: 0 };
  }

  const n = ["MASTER", "GRANDMASTER", "CHALLENGER", "UNRANKED"];

  let data = `${soloq.tier} ${soloq.rank} ${soloq.leaguePoints} LP`;

  if (n.includes(soloq.tier)) {
    data = `${soloq.tier} ${soloq.leaguePoints} LP`;
  }

  cache.set(cacheKey, data, 60);

  return { tier: soloq.tier, rank: soloq.rank, lp: soloq.leaguePoints };
}

const app = fastify();

const paramsSchema = z.object({
  id: z.string().min(1, "id parameter is required"),
  param: z
    .string()
    .optional()
    .transform((v) => (v ? decodeURIComponent(v.replace(/\+/g, " ")) : v)),
});

async function getNameByPuuid(puuid: string, region: string): Promise<string> {
  const cacheKey = `account_${puuid}`;
  const cached = cache.get(cacheKey);

  // if (cached) {
  //   return cached as string;
  // }

  const r = await axios.get(
    `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}?api_key=${env.RIOT_API}`,
  );

  if (r.status !== 200) {
    throw new Error(`Failed to fetch account data: ${r.statusText}`);
  }
  const data = r.data.gameName + "#" + r.data.tagLine;
  cache.set(cacheKey, data); // salva no cache com TTL configurado

  return data;
}

function serverWithRegion(str: string) {
  const server = str.split("(").at(1)?.replace(")", "")?.toLowerCase() ?? "br1";
  const account = str.split("(").at(0);

  if (!account) {
    throw new Error("Use o formato GameName#Tag para adicionar uma conta.");
  }

  return [server, account];
}

async function getPuuidByAccount(str: string) {
  const [server, account] = serverWithRegion(str);

  if (!account) {
    throw new Error("Use o formato GameName#Tag para adicionar uma conta.");
  }

  const [gameName, tagLine] = account.split("#").map((part) => part.trim());

  if (!tagLine) {
    throw new Error("Use o formato GameName#Tag para adicionar uma conta.");
  }

  const endpoint = `https://${getRegion(server)}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}?api_key=${env.RIOT_API}`;

  const r = await axios.get(endpoint);

  if (r.status !== 200) {
    throw new Error(`Failed to fetch account data: ${r.statusText}`);
  }

  const schema = z.object({
    gameName: z.string().min(1, "Game name is required"),
    tagLine: z.string().min(1, "Tag line is required"),
    puuid: z
      .string()
      .min(1, "Puuid is required")
      .transform((v) => server + "---" + v),
  });
  const data = schema.parse(r.data);

  return data;
}

app.get("/:id", async (request, reply) => {
  const { id } = paramsSchema.parse(request.params);

  return reply.send(await getElo(id));
});

const getRegion = (region: string = "br1") => {
  const asia = ["kr1", "jp1", "oc1", "ph2", "sg2", "th2", "vn2"];
  const europe = ["eun1", "euw1", "ru", "tr1"];

  if (asia.includes(region)) {
    return "asia";
  } else if (europe.includes(region)) {
    return "europe";
  } else {
    return "americas";
  }
};

app.get("/:id/:param", async (request, reply) => {
  const { id, param } = paramsSchema.parse(request.params);

  const subCommand = param?.split(" ").shift()?.toLowerCase();
  const args = param?.split(" ").slice(1).join(" ");

  if (!args) {
    return reply.send(await getElo(id));
  } else if (subCommand === "set" || subCommand === "add") {
    return reply.send(await setSummoner(id, args));
  } else if (
    subCommand === "remove" ||
    subCommand === "del" ||
    subCommand === "delete"
  ) {
    return reply.send(await removeSummoner(id, args));
  }

  return reply.send(await getElo(id));
});

async function removeSummoner(id: string, str: string) {
  const [server] = serverWithRegion(str);

  const { gameName, tagLine, puuid } = await getPuuidByAccount(str);

  await StreamerSchema.findOneAndUpdate(
    {
      id,
    },
    {
      $pull: {
        summoners: puuid,
      },
    },
  );

  return `A conta ${gameName}#${tagLine}(${server}) foi removida!`;
}

async function setSummoner(id: string, str: string) {
  const [server] = serverWithRegion(str);

  const { gameName, tagLine, puuid } = await getPuuidByAccount(str);

  const x = await StreamerSchema.findOneAndUpdate(
    {
      id,
    },
    {
      $addToSet: {
        summoners: puuid,
      },
    },
    {
      upsert: true,
      new: true,
    },
  );

  return `A conta ${gameName}#${tagLine}(${server}) foi adicionada!`;
}

async function getElo(id: string) {
  const noDataMessage =
    "Nenhuma conta foi adicionada ainda. Por favor, adicione uma conta para ver o ELO.";

  const r = await StreamerSchema.findOne({
    id,
  });
  if (!r || r.summoners.length === 0) {
    return noDataMessage;
  }

  const puuids = r.summoners;

  let line = " ───────────────────────────── ";
  if (id === "korris") {
    line = " ───────────────★────────────── ";
  }

  const elos: {
    name: string;
    tier: string;
    rank: "I" | "II" | "III";
    lp: number;
  }[] = [];

  for (const strPuuid of puuids) {
    const [server, puuid] = strPuuid.split("---");

    const name = await getNameByPuuid(puuid, getRegion(server));
    const { tier, rank, lp } = await getEloByPuuid(puuid, server);

    elos.push({
      name,
      tier,
      rank,
      lp,
    });
  }

  const tierOrder = {
    CHALLENGER: 11,
    GRANDMASTER: 10,
    MASTER: 9,
    DIAMOND: 8,
    EMERALD: 7,
    PLATINUM: 6,
    GOLD: 5,
    SILVER: 4,
    BRONZE: 3,
    IRON: 2,
    UNRANKED: 1,
  };

  const rankOrder = {
    I: 4,
    II: 3,
    III: 2,
    IV: 1,
  };

  elos.sort((a, b) => {
    if (a.tier !== b.tier) {
      return tierOrder[b.tier] - tierOrder[a.tier];
    }
    if (rankOrder[a.rank] !== rankOrder[b.rank]) {
      return rankOrder[b.rank] - rankOrder[a.rank];
    }
    return b.lp - a.lp;
  });

  const translatedTiers = {
    UNRANKED: "UNRANKED",
    IRON: "Ferro",
    BRONZE: "Bronze",
    SILVER: "Prata",
    GOLD: "Ouro",
    PLATINUM: "Platina",
    EMERALD: "Esmeralda",
    DIAMOND: "Diamante",
    MASTER: "Mestre",
    GRANDMASTER: "Grão-Mestre",
    CHALLENGER: "Desafiante",
  };

  const elosStr = elos.map(({ name, tier, rank, lp }) => {
    if (
      tier === "UNRANKED" ||
      tier === "MASTER" ||
      tier === "GRANDMASTER" ||
      tier === "CHALLENGER"
    ) {
      return `${name} - ${translatedTiers[tier]} ${lp} LP`;
    }

    return `${name} - ${translatedTiers[tier]} ${rank} ${lp} LP`;
  });

  return line + elosStr.join(line) + line;
}

app.get("/", async (request, reply) => {
  reply.send("Kauany API está ON!");
});

app.listen({
  port,
  host: "0.0.0.0",
});
