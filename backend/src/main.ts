import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, VERSION_NEUTRAL } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { CountryConfigService } from './config/country-config.service';

async function bootstrap() {
  // bufferLogs holds startup logs until the pino logger is wired below, so
  // even Nest's own bootstrap lines come out as structured JSON.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));

  // URI versioning: opt-in per route via @Version('1') → /v1/<route>.
  // defaultVersion VERSION_NEUTRAL keeps every existing unversioned route
  // resolving exactly as before (no /v1 prefix required).
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: VERSION_NEUTRAL,
  });

  // Enable CORS for frontend access
  app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? true 
      : ['http://localhost', 'http://localhost:80', 'http://localhost:8080', 'http://localhost:5173'],
    credentials: true,
  });

  // Enable validation globally with French error messages
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const messages = errors.map(error => {
        const constraints = error.constraints;
        if (constraints) {
          // Custom French messages for common validation errors
          if (constraints.isEnum) {
            if (error.property === 'role') {
              return `Le rôle doit être l'une des valeurs suivantes : admin, étudiant, professeur, autre`;
            }
            if (error.property === 'sexe') {
              return `Le sexe doit être l'une des valeurs suivantes : M, F, Autre`;
            }
            return constraints.isEnum;
          }
          if (constraints.isEmail) {
            return `L'email doit être une adresse email valide`;
          }

          if (constraints.isString) {
            return `Le champ ${error.property} doit être une chaîne de caractères`;
          }
          return Object.values(constraints)[0];
        }
        return `Erreur de validation pour ${error.property}`;
      });

      return {
        statusCode: 400,
        message: messages,
        error: 'Bad Request'
      };
    }
  }));

  // Configuration Swagger
  const countryConfig = app.get(CountryConfigService);
  const configuredCountries = countryConfig.getCountries();

  const config = new DocumentBuilder()
    .setTitle('API Edukia')
    .setDescription(
      'API multi-pays scopée par `pays`. Reads (GET) acceptent `?country=<slug>` ; ' +
      'writes JSON (POST/PUT/PATCH) acceptent `pays` dans le corps. Multipart uploads ' +
      'restent sur `?country=`. DELETE cible une ressource par id, donc le scope est ' +
      `implicite. Pays configurés: ${configuredCountries.join(', ') || 'aucun'}.`,
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('countries')
    .addTag('Auth')
    .addTag('utilisateurs')
    .addTag('categories')
    .addTag('parcours')
    .addTag('commentaires')
    .addTag('likes')
    .addTag('favoris')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Reflect the country contract in OpenAPI: GET carries a ?country= query
  // param, JSON write methods (POST/PUT/PATCH) carry a `pays` body field,
  // multipart writes fall back to ?country=. DELETE has no scope param —
  // the row is identified by id.
  const COUNTRY_PARAM = {
    name: 'country',
    in: 'query',
    required: false,
    description: 'Country slug used to scope responses (e.g. benin, senegal). See GET /countries for accepted values.',
    schema: { type: 'string' },
  };
  const PAYS_PROP = {
    type: 'string',
    description: 'Country slug recorded on the resource (e.g. benin, senegal). See GET /countries for accepted values.',
  };
  const hasCountryQuery = (op: any) =>
    (op.parameters || []).some((p: any) => p?.name === 'country' && p?.in === 'query');
  const addCountryQuery = (op: any) => {
    op.parameters = op.parameters || [];
    if (!hasCountryQuery(op)) op.parameters.push(COUNTRY_PARAM);
  };
  const skipCountryQuery = (pathKey: string) =>
    pathKey === '/dashboard/moi/activite';
  const injectPaysIntoSchema = (schema: any) => {
    if (!schema) return schema;
    if (schema.$ref) {
      return {
        allOf: [
          schema,
          { type: 'object', properties: { pays: PAYS_PROP } },
        ],
      };
    }
    schema.properties = schema.properties || {};
    if (!schema.properties.pays) schema.properties.pays = PAYS_PROP;
    return schema;
  };

  for (const [pathKey, pathItem] of Object.entries(document.paths || {})) {
    if (pathKey === '/countries' || pathKey.startsWith('/countries/')) continue;

    for (const method of ['get'] as const) {
      const op = (pathItem as any)[method];
      if (op && !skipCountryQuery(pathKey)) addCountryQuery(op);
    }

    for (const method of ['post', 'put', 'patch'] as const) {
      const op = (pathItem as any)[method];
      if (!op) continue;
      const content = op.requestBody?.content;
      if (!content) {
        addCountryQuery(op);
        continue;
      }
      let injectedAnywhere = false;
      for (const mediaType of Object.keys(content)) {
        if (mediaType.startsWith('multipart/')) {
          addCountryQuery(op);
          continue;
        }
        const entry = content[mediaType];
        if (entry?.schema) {
          entry.schema = injectPaysIntoSchema(entry.schema);
          injectedAnywhere = true;
        }
      }
      if (!injectedAnywhere && !hasCountryQuery(op)) {
        addCountryQuery(op);
      }
    }
  }

  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
