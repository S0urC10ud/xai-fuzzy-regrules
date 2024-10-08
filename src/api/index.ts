import express, { Request, Response } from 'express';
import multer from 'multer';
import { main } from '../shared';

// Extend the Request type to include the file property from multer
interface CustomRequest extends Request {
    file?: Express.Multer.File;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Set up multer for file handling
const upload = multer({ storage: multer.memoryStorage() });


app.post('/api/upload', upload.single('csvFile'), (req: CustomRequest, res: Response): void => {
    const csvFile = req.file;
    const metadata = req.body.metadata;

    if (!csvFile) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
    }

    if (!metadata) {
        res.status(400).json({ error: 'No metadata provided' });
        return;
    }
    
    res.status(200).json(main(JSON.parse(metadata), csvFile.buffer.toString()));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
