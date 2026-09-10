build-CameraProcessorFunction:
	python -m pip install --no-deps -r requirements.txt -t $(ARTIFACTS_DIR)
	cp app.py geometry.py image_headers.py runtime.py tokens.py $(ARTIFACTS_DIR)/
	python build_runtime.py --source . --artifacts $(ARTIFACTS_DIR)
	cp requirements.txt model-manifest.json $(ARTIFACTS_DIR)/
