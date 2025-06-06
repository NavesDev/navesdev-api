import { fastify } from "fastify";
import cors from "@fastify/cors";
import ratelimit from "@fastify/rate-limit";
import cookies from "@fastify/cookie";
import mysql from "mysql2";
import redis from "@fastify/redis"
require("dotenv").config();

const app = fastify({
  trustProxy: true,
});

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  port: parseInt(process.env.DB_PORT , 10),
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

app.register(cors, {
  origin: "https://navesdev.github.io",
  credentials:true
});

app.register(redis, {
  url:process.env.REDIS_URL,
  connectTimeout:500,
  maxLoadingRetryTime:1
})

app.register(ratelimit, {
  max: 3,
  timeWindow: 1000*60,
  global: true,
  redis:app.redis
});

app.register(cookies);

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
      code: 500
    };
  }
}

app.get("/", () => {
  return `Rotas disponíveis : '/websites', '/websites/NOMEDOSITE', '/websites/NOMEDOSITE/newaccess'`;
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

app.get("/websites/:name/newaccess", async (request: any, reply) => {
  const name = request.params.name;
  const canAcess = request.cookies[`<acess-${name}>`];
  try {
    if (!canAcess) {
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
        return reply
          .setCookie(`<acess-${name}>`, "true", {
            httpOnly: true,
            maxAge: 60 * 3,
            secure: true,
            sameSite:'None'
          })
          .send({ status: true });
      }
    } else{
		return reply.code(429).send({status:false,message:"Acesso recente percebido"})
	}
  } catch (error) {
    return reply.code(500).send({
      status: false,
      message: "Erro de comunicação interno, tente mais tarde",
    });
  }
});

app.listen({ port: 1607 }).then(() => {
  console.log("API Online!");
});
