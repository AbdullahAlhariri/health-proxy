up:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d
	cat info.txt

down:
	docker compose down