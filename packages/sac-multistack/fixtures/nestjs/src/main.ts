import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {AppModule} from './app.module';

export async function createApplication() {
  return NestFactory.create(AppModule, {logger:false});
}
