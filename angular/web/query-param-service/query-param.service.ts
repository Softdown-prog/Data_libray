import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class QueryParamService {
  read(url: string, name: string): string | null {
    if (!name.trim()) throw new TypeError('nome do parâmetro vazio');
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new TypeError('protocolo não suportado');
    }
    return parsed.searchParams.get(name);
  }
}
