import { main } from '../shared';
import { Metadata } from '../shared/types';

export function runAnalysis(metadata: Metadata, csvFile:string) {
    return main(metadata, csvFile);
}

// @ts-ignore
self.runAnalysis = runAnalysis;