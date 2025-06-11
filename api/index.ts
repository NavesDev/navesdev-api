import { fastify } from "fastify";
import cors from "@fastify/cors";
import ratelimit from "@fastify/rate-limit";
import cookies from "@fastify/cookie";
import mysql from "mysql2";
import redis from "@fastify/redis";
import ms from "ms";
import stc from "@fastify/static";
import path from "path";
require("dotenv").config();

const app = fastify({
  trustProxy: true,
});

async function bootstrap() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    port: parseInt(process.env.DB_PORT, 10),
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });

  await app.register(cors, {
    origin: ["https://navesdev.github.io","https://navesdev-api.vercel.app",process.env.PERSONAL_IP], 
    credentials: true,
  });
  await app.register(stc,{
    root:path.join(__dirname, '..', 'public')
  })

  
  await app.register(redis, {
    url: process.env.REDIS_URL,
    connectTimeout: 1000,
    maxRetriesPerRequest: 1,
  });

  await app.register(ratelimit, {
    max: 60,
    timeWindow: "1h",
    global: true,
    redis: app.redis,
    keyGenerator: function (request) {
      const ip = request.ip;
      console.log(
        { actor: "RateLimit", key: `${ip}` },
        `Nova tentativa de requisição`
      );
      return ip;
    },
    errorResponseBuilder: function (request, context) {
      request.log.warn(
        { actor: "RateLimit", ip: request.ip },
        `RATE LIMIT ATINGIDO!`
      );
      return {
        statusCode: 429,
        error: "Too Many Requests",
        message: `Limite de requisições atingido (${
          context.max
        }). Tente de novo em ${Math.ceil(context.ttl / 1000)}s ou ${Math.ceil(
          context.ttl / (1000 * 60)
        )}m.`,
        retryAfter: context.ttl / 1000,
      };
    },
  });

  await app.register(cookies);

  async function searchDataByName(name: string, wantedData: string) {
    const query = `SELECT ${wantedData} FROM website WHERE wname = ?`; //const query = "SELECT waccess FROM website WHERE wname = ?"
    try {
      const [rows]: any[] = await pool.promise().query(query, [name]);
      const data = rows.length > 0 ? rows[0] : null;
      if (data) {
        return {
          status: true,
          response: data,
        };
      } else {
        return {
          status: false,
          message: "Website não encontrado.",
          code: 404,
        };
      }
    } catch (error) {
      return {
        status: false,
        message: "Erro interno, tente novamente mais tarde.",
        code: 500,
      };
    }
  }

  app.get("/", {config:{cors:{ origin:"https://navesdev-api.vercel.app"}}},(request,reply) => {
    return reply.sendFile("index.html");
  });

  app.get("/websites", async (request, reply) => {
    try {
      const [rows]: any[] = await pool
        .promise()
        .query("SELECT wname,waccess,wcdate FROM website");
      if (rows.length > 0) {
        return reply.code(200).send({
          status: true,
          response: rows,
        });
      } else {
        return reply.code(404).send({
          status: false,
          message: "Não foram encontrados websites por algum motivo.",
        });
      }
    } catch (error) {
      return reply.code(500).send({
        status: false,
        message:
          "Houve um erro de comunicação no servidor, tente novamente mais tarde.",
      });
    }
  });

  app.get("/websites/:name", async (request: any, reply) => {
    const name = request.params.name;
    const response = await searchDataByName(name, "waccess,wname,wcdate");

    return response;
  });

  const lessRequestC = {
    config: {
      rateLimit: {
        max: 1,
        timeWindow: "2m",
        keyGenerator: function (request) {
          const name = request.params.name;
          const ip = request.ip;
          request.log.info(
            { actor: "RateLimit", key: `${name} - ${ip}` },
            `Nova tentativa de acesso`
          );
          return `${name} - ${ip}`;
        },
        errorResponseBuilder: function (request, context) {
          request.log.warn(
            { actor: "RateLimit", ip: request.ip },
            `RATE LIMIT ATINGIDO!`
          );
          return {
            statusCode: 429,
            error: "Too Many Requests",
            message: `Já foi registrado um acesso recentemente no seu dispositivo. Tente de novo em ${Math.ceil(
              context.ttl / 1000
            )}s ou ${Math.ceil(context.ttl / (1000 * 60))}m.`,
            retryAfter: context.ttl / 1000,
          };
        },
      },
    },
  };

  app.get(
    "/websites/:name/newaccess",
    lessRequestC,
    async (request: any, reply) => {
      const name = request.params.name;

      try {
        const [result]: any = await pool
          .promise()
          .query("UPDATE website SET waccess = waccess + 1 WHERE wname= ?", [
            name,
          ]);
        if (result.affectedRows === 0) {
          return reply
            .status(404)
            .send({ status: false, message: "Website não encontrado" });
        } else {
          return reply.send({
            status: true,
            nextAccess: ms(lessRequestC.config.rateLimit.timeWindow),
          });
        }
      } catch (error) {
        return reply.code(500).send({
          status: false,
          message: "Erro de comunicação interno, tente mais tarde",
        });
      }
    }
  );
  return app;
}

bootstrap().then((app) => {
  app.listen({ port: 1607 }).then(() => {
    console.log("API Online!");
  });
});
