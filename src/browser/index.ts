const appElement = document.getElementById('app');
if (appElement) {
    appElement.innerText = 'Hello from the browser!';
}

// Handle the form submission
const form = document.getElementById('uploadForm') as HTMLFormElement;

form.addEventListener('submit', async (event) => {
    event.preventDefault(); // Prevent the default form submission

    const formData = new FormData(form); // Create FormData object

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();
        if (response.ok) {
            console.log('Success:', result);
            alert(result.message);
        } else {
            console.error('Error:', result.error);
            alert(`Error: ${result.error}`);
        }
    } catch (error) {
        console.error('Error during fetch:', error);
        alert('An error occurred while uploading.');
    }
});
