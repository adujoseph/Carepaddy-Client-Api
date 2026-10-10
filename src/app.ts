import express from 'express';
import path from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { healthRouter } from '@modules/health/health.routes';
import { clientRouter } from '@routes/client';
import { adminRouter } from '@routes/admin';
import { generateOpenApiSpec } from '@docs/generate-spec';
import { errorHandler } from '@middleware/error-handler';
import { notFoundHandler } from '@middleware/not-found';

export const app = express();

app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(pinoHttp());
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

// Routes
app.use('/api/v1', healthRouter);
app.use('/api/v1/client', clientRouter);
app.use('/api/v1/admin', adminRouter);

// OpenAPI Documentation
const openApiSpec = generateOpenApiSpec();
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
