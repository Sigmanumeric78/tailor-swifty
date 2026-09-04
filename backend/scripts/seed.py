from app.core.config import get_settings
from app.data.catalog import EASE_PROFILES, GARMENTS


def main() -> None:
    settings = get_settings()
    print(f"Catalog version {settings.catalog_version}: {len(GARMENTS)} shirt templates ready.")
    print(f"Rules version {settings.rules_version}: {len(EASE_PROFILES)} provisional ease profiles ready.")


if __name__ == "__main__":
    main()

