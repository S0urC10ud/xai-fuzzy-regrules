import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import { computeMembershipDegrees } from './fuzzy';

export function generateFuzzificationChart(
    values: number[],
    min: number,
    max: number,
    key: string,
    fuzzy_classes: string[]
) {
    const width = 800,
        height = 600;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Setup directory if it doesn't exist
    const outputDir = path.join(__dirname, 'fuzzifications');
    mkdirSync(outputDir, { recursive: true });

    // Background
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);

    // Define margins
    const margin = { top: 50, right: 50, bottom: 50, left: 100 };

    // Calculate step for 7 fuzzy sets
    const numFuzzySets = 7;
    const step = (max - min) / (numFuzzySets - 1);

    // Define key points
    const points = Array.from({ length: numFuzzySets }, (_, i) => min + i * step);

    // Scaled positions
    const scaleX = (value: number) => {
        return (
            margin.left +
            ((value - min) / (max - min)) * (width - margin.left - margin.right)
        );
    };

    const scaledPoints = points.map(scaleX);

    // Y-axis positions (membership degree from 0 to 1)
    const yZero = height - margin.bottom;
    const yOne = margin.top;

    // Draw X-axis
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(margin.left, yZero);
    ctx.lineTo(width - margin.right, yZero);
    ctx.stroke();

    // Draw Y-axis (optional, for reference)
    ctx.beginPath();
    ctx.moveTo(margin.left, yZero);
    ctx.lineTo(margin.left, margin.top);
    ctx.stroke();

    // Labels and ticks
    ctx.font = '16px Arial';
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.fillText(`Value Ranges (${key})`, width / 2, height - 10);

    // X-axis labels
    points.forEach((point, index) => {
        ctx.textAlign = 'center';
        ctx.fillText(`${point.toFixed(2)}`, scaledPoints[index], yZero + 30);
    });

    // Draw ticks
    const tickLength = 10;
    scaledPoints.forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, yZero);
        ctx.lineTo(x, yZero + tickLength);
        ctx.stroke();
    });

    // Define fuzzy set colors
    const fuzzySets = [
        { name: 'verylow', color: 'rgba(128, 0, 128, 0.7)' },    // Purple
        { name: 'low', color: 'rgba(255, 0, 0, 0.7)' },         // Red
        { name: 'mediumlow', color: 'rgba(255, 165, 0, 0.7)' }, // Orange
        { name: 'medium', color: 'rgba(255, 255, 0, 0.7)' },     // Yellow
        { name: 'mediumhigh', color: 'rgba(173, 255, 47, 0.7)' }, // GreenYellow
        { name: 'high', color: 'rgba(0, 255, 0, 0.7)' },        // Green
        { name: 'veryhigh', color: 'rgba(0, 0, 255, 0.7)' },    // Blue
    ];

    // Draw fuzzy sets
    fuzzySets.forEach((fuzzySet, index) => {
        // Define the shape based on membership degrees
        ctx.strokeStyle = fuzzySet.color;
        ctx.fillStyle = fuzzySet.color.replace('0.7', '0.5'); // Darker fill
        ctx.beginPath();

        // Draw triangles for all fuzzy sets
        if (fuzzySet.name === 'verylow') {
            // Right-angled triangle for verylow (covering min)
            ctx.moveTo(scaledPoints[0], yZero); // Start at min
            ctx.lineTo(scaledPoints[0], yOne); // Peak at min (right-angled)
            ctx.lineTo(scaledPoints[1], yZero); // End at second point
        } else if (fuzzySet.name === 'veryhigh') {
            // Right-angled triangle for veryhigh (covering max)
            ctx.moveTo(scaledPoints[numFuzzySets - 2], yZero); // Start at second last point
            ctx.lineTo(scaledPoints[numFuzzySets - 1], yOne); // Peak at max (right-angled)
            ctx.lineTo(scaledPoints[numFuzzySets - 1], yZero); // End at max
        } else {
            // Triangular for others
            ctx.moveTo(scaledPoints[index - 1], yZero); // Start at previous point
            ctx.lineTo(scaledPoints[index], yOne); // Peak at current point
            ctx.lineTo(scaledPoints[index + 1], yZero); // End at next point
        }

        ctx.closePath();
        ctx.stroke();
    });

    // Plot points for each record with random vertical jitter and membership degree colors
    values.forEach((value) => {
        // Ensure the value is within the range
        if (value < min || value > max) return;

        // Get the membership degrees
        const degrees = computeMembershipDegrees(value, min, max, fuzzy_classes);

        // Generate the color by mixing colors based on the membership degrees
        // Here, we assign colors based on the highest membership degree
        const fuzzySetKeys = ['verylow', 'low', 'mediumlow', 'medium', 'mediumhigh', 'high', 'veryhigh'];
        let maxDegree = 0;
        let selectedColor = 'rgba(0,0,0,0.2)'; // Default color

        fuzzySetKeys.forEach((key, idx) => {
            if (degrees[key as keyof typeof degrees] > maxDegree) {
                maxDegree = degrees[key as keyof typeof degrees];
                selectedColor = fuzzySets[idx].color.replace('0.7', '0.5'); // Darker fill for points too
            }
        });

        // Calculate the x position on the chart
        const x = scaleX(value);

        // Add random jitter for vertical differentiation
        const randomJitter = Math.random() * 20;

        // Draw the point
        ctx.fillStyle = selectedColor;
        ctx.beginPath();
        ctx.arc(x, yZero - randomJitter, 5, 0, Math.PI * 2);
        ctx.fill();
    });

    // Save the chart as a PNG
    const outputPath = path.join(outputDir, `${key}.png`);
    writeFileSync(outputPath, canvas.toBuffer('image/png'));
    console.log(`Chart saved: ${outputPath}`);
}
