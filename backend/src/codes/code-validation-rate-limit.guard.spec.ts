import {
  Controller,
  INestApplication,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { CodeValidationRateLimitGuard } from './code-validation-rate-limit.guard';

@Controller('codes-test')
class CodesRateLimitTestController {
  @Post('valider')
  @UseGuards(CodeValidationRateLimitGuard)
  valider(@Request() req) {
    return { utilisateurId: req.user.utilisateurId };
  }
}

describe('CodeValidationRateLimitGuard', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [
            { name: 'codes-burst', ttl: 60_000, limit: 2 },
            { name: 'codes-hourly', ttl: 3_600_000, limit: 100 },
          ],
          errorMessage:
            'Trop de tentatives de validation de code. Réessayez plus tard.',
        }),
      ],
      controllers: [CodesRateLimitTestController],
      providers: [CodeValidationRateLimitGuard],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { utilisateurId: Number(req.headers['x-test-user']) };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('bloque les essais répétés du même utilisateur avec une réponse 429', async () => {
    const serveur = app.getHttpServer();

    await request(serveur)
      .post('/codes-test/valider')
      .set('x-test-user', '10')
      .expect(201);
    const seconde = await request(serveur)
      .post('/codes-test/valider')
      .set('x-test-user', '10')
      .expect(201);
    expect(seconde.headers['x-ratelimit-limit-codes-burst']).toBe('2');

    const bloquee = await request(serveur)
      .post('/codes-test/valider')
      .set('x-test-user', '10')
      .expect(429);
    expect(bloquee.body.message).toContain('Trop de tentatives');
    expect(bloquee.headers['retry-after-codes-burst']).toBeDefined();
  });

  it('isole le quota de chaque utilisateur authentifié', async () => {
    await request(app.getHttpServer())
      .post('/codes-test/valider')
      .set('x-test-user', '20')
      .expect(201)
      .expect({ utilisateurId: 20 });
  });
});
