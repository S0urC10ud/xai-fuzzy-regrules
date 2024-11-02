import { main } from '../shared';
import { Metadata } from '../shared/types';

const appElement = document.getElementById('app');
if (appElement) {
    appElement.innerText = 'Hello from the browser!';
}

function runAnalyis(metadata: Metadata, csvFile:string) {
    return main(metadata, csvFile);
}
(window as any).runAnalyis = runAnalyis;