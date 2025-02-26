import express, { Application } from 'express';
import bodyParser from 'body-parser';
import searchRoutes from './routes/searchRoutes';
import readRoutes from './routes/readRoutes';
import dotenv from 'dotenv';

dotenv.config();

const app: Application = express();

app.use(bodyParser.json());
app.use('/api', searchRoutes);
app.use('/api', readRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));