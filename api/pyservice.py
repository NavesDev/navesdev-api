from google import genai;
from google.api_core import exceptions as google_exceptions;
from google.generativeai.types import StopCandidateException;
from google.genai import types;
from dataclasses import dataclass;
from api.modules.systemInstruction import returnSI;
from fastapi import FastAPI,Header,Request,HTTPException;
from fastapi.middleware.cors import CORSMiddleware;
from typing import Optional,Any;
from pydantic import BaseModel;
import json;
import os;

origins = [
  
    "https://navesdev.github.io", 
    "http://localhost",
    "http://localhost:3000", # Se o seu frontend de teste rodar aqui
    "http://127.0.0.1:5500", 
]

internal_key = os.environ.get("INTERNAL_KEY")
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins="[*]", 
    allow_credentials=True, 
    allow_methods=["*"], 
    allow_headers=["*"],
)

def registerClient():
    g_api_key = os.environ.get("GEMINI_API_KEY")
    return genai.Client(api_key=g_api_key)

@dataclass
class responseFormat:
    message:str
    commands:list[str]

class historyItem(BaseModel):
    role: str
    parts: list[dict[str, str]]

class requestBody(BaseModel):
    history:list[historyItem]
    dbData:dict[str,list[dict[str,Any]]]


@app.post("/camisai")
async def aiChat(body: requestBody, internal_token: Optional[str] = Header(None, alias="x-internal-token")):
    if(not internal_key or internal_token != internal_key):
        raise HTTPException(status_code=403, detail="Acesso Negado.")
    client = registerClient()
    
    try:
        history = body.model_dump()["history"]
        
        response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=history,
        config= types.GenerateContentConfig(
            system_instruction=returnSI(body.dbData),
            response_schema= responseFormat,
            response_mime_type="application/json"
        )) 
        
        return json.loads(response.text);
    except google_exceptions.ResourceExhausted as e:
        print(f"Erro de excesso de requisições: {e}")
        raise HTTPException(
            status_code=429, 
            detail={
                "message" : "Excesso de requisições",
                "specialCode":"1.1",    
                "specialMessage" : "Estou recebendo muitas mensagens! Tente novamente em alguns segundos😊"
                },
        )
    except StopCandidateException as e:
        print(f"Mensagem bloqueada por motivos de segurança: {e}")
        raise HTTPException(
            status_code=400,
            detail={
                "message" : "Mensagem bloqueada por motivos de segurança.",
                "specialCode":"2.5",    
                "specialMessage" : "Sua mensagem é inadequada e para manter um abiente de respeito, você será banido do chat temporariamente"
                })
    except Exception as e:
        print(f"ERRO GENÉRICO NA CHAMADA DO GEMINI: {e}")
        raise HTTPException(
            status_code=500,
            detail={
                "message" : "Ocorreu um erro interno para se comunicar com a IA.",
                "specialCode":"2.0",    
                "specialMessage" : "Algo deu errado, tente novamente"
                }
        )
