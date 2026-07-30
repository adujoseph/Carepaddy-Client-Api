import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { healthRouter } from '@modules/health/health.routes';
import { clientRouter } from '@routes/client';
import { generateOpenApiSpec } from '@docs/generate-spec';
import { errorHandler } from '@middleware/error-handler';
import { notFoundHandler } from '@middleware/not-found';

export const app = express();

app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(pinoHttp());

// Routes
app.use('/api/v1', healthRouter);
app.use('/api/v1/client', clientRouter);

// OpenAPI Documentation
const openApiSpec = generateOpenApiSpec();
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
