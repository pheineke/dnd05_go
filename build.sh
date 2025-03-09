#!/bin/bash

GOOS=windows GOARCH=amd64 go build -o server_WIN64.exe

GOOS=linux GOARCH=amd64 go build -o server_UNIX64

zip -r dnd_server_v1.0.0.zip ./*