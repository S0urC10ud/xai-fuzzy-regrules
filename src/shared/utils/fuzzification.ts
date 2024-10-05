import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import * as path from 'path';
import { computeMembershipDegrees } from './fuzzy';

export function generateFuzzificationChart(
    values: number[],
    min: number,
    q1: number,
    q2: number,
    max: number,
    key: string
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
    const margin = { top: 50, right: 50, bottom: 50, left: 50 };

    // Scaled positions
    const scaleX = (value: number) => {
        return (
            margin.left +
            ((value - min) / (max - min)) * (width - margin.left - margin.right)
        );
    };

    const xMin = scaleX(min);
    const xQ1 = scaleX(q1);
    const xQ2 = scaleX(q2);
    const xMax = scaleX(max);

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
    ctx.textAlign = 'center';
    ctx.fillText(`${min.toFixed(2)}`, xMin, yZero + 30);
    ctx.fillText(`${q1.toFixed(2)}`, xQ1, yZero + 30);
    ctx.fillText(`${q2.toFixed(2)}`, xQ2, yZero + 30);
    ctx.fillText(`${max.toFixed(2)}`, xMax, yZero + 30);

    // Draw ticks
    const tickLength = 10;
    [xMin, xQ1, xQ2, xMax].forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, yZero);
        ctx.lineTo(x, yZero + tickLength);
        ctx.stroke();
    });

    // Draw fuzzy sets
    // Low - Red Triangle
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
    ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.moveTo(xMin, yZero); // Start at min
    ctx.lineTo(xMin, yOne); // Peak at min
    ctx.lineTo(xQ1, yZero); // End at q1
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Medium - Green Trapezoid with lower base from min to max
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.7)';
    ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
    ctx.beginPath();
    ctx.moveTo(xMin, yZero); // Start at min
    ctx.lineTo(xQ1, yOne); // Rising to q1
    ctx.lineTo(xQ2, yOne); // Plateau at q2
    ctx.lineTo(xMax, yZero); // Descend to max
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // High - Blue Triangle
    ctx.strokeStyle = 'rgba(0, 0, 255, 0.7)';
    ctx.fillStyle = 'rgba(0, 0, 255, 0.3)';
    ctx.beginPath();
    ctx.moveTo(xQ2, yZero); // Start at q2
    ctx.lineTo(xMax, yOne); // Peak at max
    ctx.lineTo(xMax, yZero); // End at max
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Plot points for each record with random vertical jitter and membership degree colors
    values.forEach((value) => {
        // Ensure the value is within the range
        if (value < min || value > max) return;

        // Get the membership degrees
        const { low, medium, high } = computeMembershipDegrees(
            value,
            min,
            q1,
            q2,
            max
        );

        // Generate the color by mixing red, green, and blue based on the membership degrees
        const r = Math.floor(low * 255); // Red component (low)
        const g = Math.floor(medium * 255); // Green component (medium)
        const b = Math.floor(high * 255); // Blue component (high)

        // Set the fill style based on the RGB values with opacity 0.2
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.2)`;

        // Calculate the x position on the chart
        const x = scaleX(value);

        // Add random jitter for vertical differentiation
        const randomJitter = Math.random() * 20;

        // Draw the point
        ctx.beginPath();
        ctx.arc(x, yZero - randomJitter, 5, 0, Math.PI * 2);
        ctx.fill();
    });

    // Save the chart as a PNG
    const outputPath = path.join(outputDir, `${key}.png`);
    writeFileSync(outputPath, canvas.toBuffer('image/png'));
    console.log(`Chart saved: ${outputPath}`);
}