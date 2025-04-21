// literally just forwards the satdump http server from local ip
document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/stats')
      .then(res => res.json())
      .then(data => {
        const hostIp = data.hostIp;
        document.getElementById('satdump-frame').src = `http://${hostIp}:8081`; //change port if needed
      })
      .catch(err => {
        console.error('Failed to load SatDump iframe:', err);
        document.body.innerHTML = '<h2 style="color: red;">Unable to load SatDump interface</h2>';
      });
  });